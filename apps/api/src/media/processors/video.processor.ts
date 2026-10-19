import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';

import { StorageService } from '../../storage/storage.service';
import { PrismaService } from '../../common/database/prisma.service';

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

interface VideoProcessingJob {
  key: string;
  userId: string;
  contentId?: string;
  originalName: string;
  mimeType: string;
  size: number;
}

// Progress milestones (percent of the whole job)
const TRANSCODE_START = 15;
const WATERMARK_START = 70;
const UPLOAD_START = 90;

/** Map a 0-100 sub-step percentage onto the [from, to] range of the whole job */
const scale = (percent: number, from: number, to: number) =>
  from + (Math.max(0, Math.min(100, percent)) / 100) * (to - from);

@Processor('video-processing')
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name);
  private readonly watermarkEnabled: boolean;
  private readonly watermarkText: string;

  constructor(
    private storageService: StorageService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.watermarkEnabled = this.configService.get('WATERMARK_ENABLED') === 'true';
    this.watermarkText = this.configService.get('WATERMARK_TEXT', 'OFM');
  }

  @Process('process-video')
  async processVideo(job: Job<VideoProcessingJob>) {
    const { key, userId, contentId, originalName, mimeType, size } = job.data;

    this.logger.log(`Processing video: ${key}`);

    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `input-${Date.now()}.mp4`);
    const outputPath = path.join(tempDir, `output-${Date.now()}.mp4`);
    const thumbnailPath = path.join(tempDir, `thumb-${Date.now()}.jpg`);

    try {
      // Download video from S3
      await this.reportProgress(job, 1);
      const videoBuffer = await this.storageService.getFile(key);
      await writeFile(inputPath, videoBuffer);
      await this.reportProgress(job, 5);

      // Get video metadata
      const metadata = await this.getVideoMetadata(inputPath);
      await this.reportProgress(job, 8);

      // Generate thumbnail
      await this.generateThumbnail(inputPath, thumbnailPath);
      const thumbnailBuffer = await fs.promises.readFile(thumbnailPath);
      const thumbnailKey = key.replace(path.extname(key), '-thumb.jpg');
      await this.storageService.uploadFile(
        thumbnailBuffer,
        'thumbnail.jpg',
        'image/jpeg',
        path.dirname(key),
      );
      await this.reportProgress(job, TRANSCODE_START);

      // Transcode video (H.264, 1080p max)
      const transcodeEnd = this.watermarkEnabled ? WATERMARK_START : UPLOAD_START;
      await this.transcodeVideo(inputPath, outputPath, (percent) =>
        this.reportProgress(job, scale(percent, TRANSCODE_START, transcodeEnd)),
      );
      await this.reportProgress(job, transcodeEnd);

      // Apply watermark if enabled
      if (this.watermarkEnabled) {
        const watermarkedPath = path.join(tempDir, `watermarked-${Date.now()}.mp4`);
        await this.applyWatermark(outputPath, watermarkedPath, (percent) =>
          this.reportProgress(job, scale(percent, WATERMARK_START, UPLOAD_START)),
        );
        await this.reportProgress(job, UPLOAD_START);
        // Replace output with watermarked version
        await unlink(outputPath);
        await fs.promises.rename(watermarkedPath, outputPath);
      }

      // Upload processed video
      const processedBuffer = await fs.promises.readFile(outputPath);
      await this.storageService.uploadFile(
        processedBuffer,
        originalName,
        mimeType,
        path.dirname(key),
      );
      await this.reportProgress(job, 95);

      // Save to database if contentId provided
      if (contentId) {
        await this.prisma.contentFile.create({
          data: {
            contentId,
            filename: path.basename(key),
            originalName,
            mimeType,
            size: BigInt(size),
            storagePath: key,
            thumbnailPath: thumbnailKey,
            width: metadata.width,
            height: metadata.height,
            duration: metadata.duration,
            isEncrypted: false,
            hasWatermark: this.watermarkEnabled,
          },
        });
      }

      await this.reportProgress(job, 100);
      this.logger.log(`Video processed successfully: ${key}`);

      return {
        success: true,
        key,
        thumbnailPath: thumbnailKey,
        metadata,
      };
    } catch (error) {
      this.logger.error(`Failed to process video: ${error.message}`, error.stack);
      throw error;
    } finally {
      // Cleanup temp files
      await Promise.all([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {}),
        unlink(thumbnailPath).catch(() => {}),
      ]);
    }
  }

  /**
   * Report job progress (0-100) so clients can poll GET /media/jobs/:id/status.
   * Only forwards increases, and never fails the job.
   */
  private async reportProgress(job: Job<VideoProcessingJob>, value: number) {
    try {
      const current = Number(job.progress()) || 0;
      const next = Math.max(0, Math.min(100, Math.round(value)));
      if (next > current) {
        await job.progress(next);
      }
    } catch (error) {
      this.logger.debug(`Unable to report progress for job ${job.id}: ${error.message}`);
    }
  }

  /**
   * Get video metadata
   */
  private getVideoMetadata(inputPath: string): Promise<{
    width: number;
    height: number;
    duration: number;
    bitrate: number;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        resolve({
          width: videoStream.width!,
          height: videoStream.height!,
          duration: Math.floor(metadata.format.duration!),
          bitrate: metadata.format.bit_rate!,
        });
      });
    });
  }

  /**
   * Generate thumbnail from video
   */
  private generateThumbnail(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          count: 1,
          folder: path.dirname(outputPath),
          filename: path.basename(outputPath),
          timestamps: ['10%'], // Take screenshot at 10% of video
          size: '320x240',
        })
        .on('end', () => resolve())
        .on('error', reject);
    });
  }

  /**
   * Transcode video to H.264, 1080p max
   */
  private transcodeVideo(
    inputPath: string,
    outputPath: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264', // H.264 codec
          '-preset medium', // Encoding speed
          '-crf 23', // Quality (lower = better, 23 is good)
          '-maxrate 5M', // Max bitrate
          '-bufsize 10M',
          '-vf scale=min(1920\\,iw):-2', // Scale to 1080p max, maintain aspect ratio
          '-c:a aac', // AAC audio codec
          '-b:a 128k', // Audio bitrate
          '-movflags +faststart', // Enable streaming
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .on('progress', (progress: any) => {
          this.logger.debug(`Transcoding progress: ${progress.percent?.toFixed(2)}%`);
          if (onProgress && typeof progress.percent === 'number') {
            onProgress(progress.percent);
          }
        })
        .run();
    });
  }

  /**
   * Apply watermark to video
   */
  private applyWatermark(
    inputPath: string,
    outputPath: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-vf',
          `drawtext=text='${this.watermarkText}':fontcolor=white@0.5:fontsize=24:x=W-tw-10:y=H-th-10`,
          '-c:a copy', // Copy audio without re-encoding
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .on('progress', (progress: any) => {
          if (onProgress && typeof progress.percent === 'number') {
            onProgress(progress.percent);
          }
        })
        .run();
    });
  }
}
