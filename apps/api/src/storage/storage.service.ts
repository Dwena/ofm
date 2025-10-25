import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;
  private bucket: string;

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.get('AWS_S3_ENDPOINT');
    const region = this.configService.get('AWS_REGION', 'eu-west-1');
    const forcePathStyle = this.configService.get('AWS_S3_FORCE_PATH_STYLE') === 'true';

    this.s3Client = new S3Client({
      endpoint: endpoint || undefined,
      region,
      forcePathStyle,
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID') ||
                     this.configService.get('MINIO_ACCESS_KEY', ''),
        secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY') ||
                        this.configService.get('MINIO_SECRET_KEY', ''),
      },
    });

    this.bucket = this.configService.get('AWS_S3_BUCKET', 'ofm-content-dev');
  }

  /**
   * Upload a file to S3/MinIO
   */
  async uploadFile(
    file: Buffer,
    originalName: string,
    mimeType: string,
    folder: string = 'uploads',
  ): Promise<{ key: string; url: string }> {
    const ext = path.extname(originalName);
    const filename = `${nanoid(16)}${ext}`;
    const key = `${folder}/${filename}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file,
          ContentType: mimeType,
          // Server-side encryption
          ServerSideEncryption: 'AES256',
          // Cache control
          CacheControl: 'max-age=31536000', // 1 year
        }),
      );

      this.logger.log(`File uploaded: ${key}`);

      // Generate URL (will be signed later for private access)
      const url = `https://${this.bucket}.s3.amazonaws.com/${key}`;

      return { key, url };
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get a signed URL for private file access
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error) {
      this.logger.error(`Failed to generate signed URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a file from S3/MinIO
   */
  async deleteFile(key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      this.logger.log(`File deleted: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get file as buffer
   */
  async getFile(key: string): Promise<Buffer> {
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Failed to get file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate a unique folder path for user content
   */
  generateUserPath(userId: string, contentType: 'images' | 'videos' | 'audio' | 'thumbnails'): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    return `users/${userId}/${contentType}/${year}/${month}`;
  }
}
