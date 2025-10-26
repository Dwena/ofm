import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import * as sharp from 'sharp';
import * as path from 'path';

import { StorageService } from '../../storage/storage.service';
import { PrismaService } from '../../common/database/prisma.service';

interface ImageProcessingJob {
  key: string;
  userId: string;
  contentId?: string;
  originalName: string;
  mimeType: string;
  size: number;
}

@Processor('image-processing')
export class ImageProcessor {
  private readonly logger = new Logger(ImageProcessor.name);
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

  @Process('process-image')
  async processImage(job: Job<ImageProcessingJob>) {
    const { key, userId, contentId, originalName, mimeType, size } = job.data;

    this.logger.log(`Processing image: ${key}`);

    try {
      // Download original image from S3
      const originalBuffer = await this.storageService.getFile(key);

      // Get image metadata
      const metadata = await sharp(originalBuffer).metadata();

      // Generate thumbnail (300x300)
      const thumbnailBuffer = await this.generateThumbnail(originalBuffer);
      const thumbnailPath = key.replace(
        path.extname(key),
        '-thumb' + path.extname(key),
      );
      await this.storageService.uploadFile(
        thumbnailBuffer,
        'thumbnail.jpg',
        'image/jpeg',
        path.dirname(key),
      );

      // Apply watermark if enabled
      let processedBuffer = originalBuffer;
      if (this.watermarkEnabled) {
        processedBuffer = await this.applyWatermark(originalBuffer);
        // Replace original with watermarked version
        await this.storageService.uploadFile(
          processedBuffer,
          originalName,
          mimeType,
          path.dirname(key),
        );
      }

      // Optimize image
      const optimizedBuffer = await this.optimizeImage(processedBuffer, mimeType);
      await this.storageService.uploadFile(
        optimizedBuffer,
        originalName,
        mimeType,
        path.dirname(key),
      );

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
            thumbnailPath,
            width: metadata.width,
            height: metadata.height,
            isEncrypted: false,
            hasWatermark: this.watermarkEnabled,
          },
        });
      }

      this.logger.log(`Image processed successfully: ${key}`);

      return {
        success: true,
        key,
        thumbnailPath,
        metadata: {
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to process image: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate thumbnail
   */
  private async generateThumbnail(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .resize(300, 300, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  /**
   * Apply watermark to image
   */
  private async applyWatermark(buffer: Buffer): Promise<Buffer> {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Create watermark text as SVG
    const watermarkSvg = Buffer.from(`
      <svg width="${metadata.width}" height="${metadata.height}">
        <style>
          .watermark {
            font-family: Arial, sans-serif;
            font-size: 24px;
            fill: rgba(255, 255, 255, 0.5);
            font-weight: bold;
          }
        </style>
        <text
          x="${metadata.width! - 120}"
          y="${metadata.height! - 30}"
          class="watermark"
        >
          ${this.watermarkText}
        </text>
      </svg>
    `);

    return image
      .composite([
        {
          input: watermarkSvg,
          gravity: 'southeast',
        },
      ])
      .toBuffer();
  }

  /**
   * Optimize image
   */
  private async optimizeImage(buffer: Buffer, mimeType: string): Promise<Buffer> {
    const image = sharp(buffer);

    switch (mimeType) {
      case 'image/jpeg':
      case 'image/jpg':
        return image.jpeg({ quality: 85, progressive: true }).toBuffer();

      case 'image/png':
        return image.png({ compressionLevel: 9, progressive: true }).toBuffer();

      case 'image/webp':
        return image.webp({ quality: 85 }).toBuffer();

      default:
        return buffer;
    }
  }
}
