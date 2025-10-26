import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MediaValidator {
  private readonly allowedImageFormats: string[];
  private readonly allowedVideoFormats: string[];
  private readonly allowedAudioFormats: string[];
  private readonly maxImageSize: number;
  private readonly maxVideoSize: number;
  private readonly maxAudioSize: number;

  constructor(private configService: ConfigService) {
    this.allowedImageFormats = this.configService
      .get('ALLOWED_IMAGE_FORMATS', 'jpg,jpeg,png,gif,webp')
      .split(',');
    this.allowedVideoFormats = this.configService
      .get('ALLOWED_VIDEO_FORMATS', 'mp4,mov,avi,mkv,webm')
      .split(',');
    this.allowedAudioFormats = this.configService
      .get('ALLOWED_AUDIO_FORMATS', 'mp3,wav,aac,m4a')
      .split(',');

    const maxFileSizeMB = parseInt(
      this.configService.get('MAX_FILE_SIZE_MB', '500'),
    );
    this.maxImageSize = 10 * 1024 * 1024; // 10MB
    this.maxVideoSize = maxFileSizeMB * 1024 * 1024;
    this.maxAudioSize = 50 * 1024 * 1024; // 50MB
  }

  validateImage(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Check file size
    if (file.size > this.maxImageSize) {
      throw new BadRequestException(
        `Image size exceeds maximum allowed size of ${this.maxImageSize / 1024 / 1024}MB`,
      );
    }

    // Check MIME type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid image format. Allowed: ${this.allowedImageFormats.join(', ')}`,
      );
    }

    // Check file extension
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!ext || !this.allowedImageFormats.includes(ext)) {
      throw new BadRequestException(
        `Invalid file extension. Allowed: ${this.allowedImageFormats.join(', ')}`,
      );
    }
  }

  validateVideo(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Check file size
    if (file.size > this.maxVideoSize) {
      throw new BadRequestException(
        `Video size exceeds maximum allowed size of ${this.maxVideoSize / 1024 / 1024}MB`,
      );
    }

    // Check MIME type
    const allowedMimeTypes = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/webm',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid video format. Allowed: ${this.allowedVideoFormats.join(', ')}`,
      );
    }

    // Check file extension
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!ext || !this.allowedVideoFormats.includes(ext)) {
      throw new BadRequestException(
        `Invalid file extension. Allowed: ${this.allowedVideoFormats.join(', ')}`,
      );
    }
  }

  validateAudio(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Check file size
    if (file.size > this.maxAudioSize) {
      throw new BadRequestException(
        `Audio size exceeds maximum allowed size of ${this.maxAudioSize / 1024 / 1024}MB`,
      );
    }

    // Check MIME type
    const allowedMimeTypes = [
      'audio/mpeg',
      'audio/wav',
      'audio/aac',
      'audio/mp4',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid audio format. Allowed: ${this.allowedAudioFormats.join(', ')}`,
      );
    }

    // Check file extension
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!ext || !this.allowedAudioFormats.includes(ext)) {
      throw new BadRequestException(
        `Invalid file extension. Allowed: ${this.allowedAudioFormats.join(', ')}`,
      );
    }
  }
}
