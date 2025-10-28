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

    // Check if file is empty
    if (file.size === 0) {
      throw new BadRequestException('File is empty');
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

    // Validate file signature (magic bytes) to prevent file spoofing
    this.validateFileSignature(file.buffer, file.mimetype);

    // Validate filename
    this.validateFilename(file.originalname);
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

  /**
   * Validate file signature (magic bytes) to prevent MIME type spoofing
   */
  private validateFileSignature(buffer: Buffer, mimeType: string): void {
    if (!buffer || buffer.length < 4) {
      throw new BadRequestException('Invalid file: insufficient data');
    }

    const signatures: Record<string, number[][]> = {
      'image/jpeg': [[0xff, 0xd8, 0xff]],
      'image/png': [[0x89, 0x50, 0x4e, 0x47]],
      'image/gif': [[0x47, 0x49, 0x46, 0x38]],
      'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF
      'video/mp4': [[0x00, 0x00, 0x00], [0x66, 0x74, 0x79, 0x70]], // ftyp at offset 4
      'video/webm': [[0x1a, 0x45, 0xdf, 0xa3]],
    };

    const expectedSignatures = signatures[mimeType];
    if (!expectedSignatures) {
      return; // No signature validation for this type
    }

    const fileSignature = Array.from(buffer.slice(0, 8));

    const isValid = expectedSignatures.some(signature =>
      signature.every((byte, index) => fileSignature[index] === byte)
    );

    if (!isValid) {
      throw new BadRequestException(
        'File signature does not match declared MIME type. Possible file spoofing detected.',
      );
    }
  }

  /**
   * Validate filename for security
   */
  private validateFilename(filename: string): void {
    // Check for path traversal attempts
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new BadRequestException('Invalid filename: path traversal detected');
    }

    // Check for null bytes
    if (filename.includes('\0')) {
      throw new BadRequestException('Invalid filename: null byte detected');
    }

    // Check length
    if (filename.length > 255) {
      throw new BadRequestException('Filename too long (max 255 characters)');
    }

    // Check for suspicious characters
    const dangerousChars = /[<>:"|?*\x00-\x1f]/;
    if (dangerousChars.test(filename)) {
      throw new BadRequestException('Invalid filename: contains dangerous characters');
    }
  }

  /**
   * Validate total upload size for multiple files
   */
  validateTotalSize(files: Express.Multer.File[], maxTotalSize: number): void {
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    if (totalSize > maxTotalSize) {
      throw new BadRequestException(
        `Total upload size exceeds maximum allowed size of ${maxTotalSize / 1024 / 1024}MB`,
      );
    }
  }

  /**
   * Sanitize filename
   */
  sanitizeFilename(filename: string): string {
    // Remove path components
    filename = filename.split('/').pop()!.split('\\').pop()!;

    // Remove dangerous characters
    filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Ensure it has an extension
    if (!filename.includes('.')) {
      filename += '.bin';
    }

    return filename;
  }
}
