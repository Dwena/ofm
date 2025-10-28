import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';

import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../common/database/prisma.service';
import { MediaValidator } from './validators/media.validator';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private storageService: StorageService,
    private prisma: PrismaService,
    private mediaValidator: MediaValidator,
    private configService: ConfigService,
    @InjectQueue('image-processing') private imageQueue: Queue,
    @InjectQueue('video-processing') private videoQueue: Queue,
  ) {}

  /**
   * General file upload - Auto-detects type and creates ContentFile record
   */
  async upload(file: Express.Multer.File, userId: string) {
    // Determine file type
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');
    const isPdf = file.mimetype === 'application/pdf';

    let type: 'IMAGE' | 'VIDEO' | 'FILE';
    let folder: string;
    let queue: Queue | null = null;

    if (isImage) {
      this.mediaValidator.validateImage(file);
      type = 'IMAGE';
      folder = this.storageService.generateUserPath(userId, 'images');
      queue = this.imageQueue;
    } else if (isVideo) {
      this.mediaValidator.validateVideo(file);
      type = 'VIDEO';
      folder = this.storageService.generateUserPath(userId, 'videos');
      queue = this.videoQueue;
    } else if (isPdf) {
      type = 'FILE';
      folder = this.storageService.generateUserPath(userId, 'images');
    } else {
      throw new BadRequestException('Unsupported file type');
    }

    // Upload to storage
    const { key, url } = await this.storageService.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      folder,
    );

    // Create ContentFile record
    const contentFile = await this.prisma.contentFile.create({
      data: {
        storagePath: key,
        filename: file.originalname,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: BigInt(file.size),
      },
    });

    // Queue for processing if needed
    if (queue) {
      await queue.add(`process-${type.toLowerCase()}`, {
        contentFileId: contentFile.id,
        key,
        userId,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });

      this.logger.log(`${type} queued for processing: ${key}`);
    }

    return {
      id: contentFile.id,
      filename: contentFile.filename,
      url: url,
      size: Number(contentFile.size),
      message: queue
        ? `${type} uploaded and queued for processing`
        : 'File uploaded successfully',
    };
  }

  /**
   * Upload an image
   */
  async uploadImage(
    file: Express.Multer.File,
    userId: string,
    contentId?: string,
  ) {
    // Validate file
    this.mediaValidator.validateImage(file);

    // Generate path
    const folder = this.storageService.generateUserPath(userId, 'images');

    // Upload original
    const { key, url } = await this.storageService.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      folder,
    );

    // Queue for processing (resize, watermark, optimize)
    await this.imageQueue.add('process-image', {
      key,
      userId,
      contentId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    });

    this.logger.log(`Image queued for processing: ${key}`);

    return {
      key,
      url,
      status: 'processing',
      message: 'Image uploaded and queued for processing',
    };
  }

  /**
   * Upload a video
   */
  async uploadVideo(
    file: Express.Multer.File,
    userId: string,
    contentId?: string,
  ) {
    // Validate file
    this.mediaValidator.validateVideo(file);

    // Generate path
    const folder = this.storageService.generateUserPath(userId, 'videos');

    // Upload original
    const { key, url } = await this.storageService.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      folder,
    );

    // Queue for processing (transcode, thumbnail, watermark)
    await this.videoQueue.add('process-video', {
      key,
      userId,
      contentId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    });

    this.logger.log(`Video queued for processing: ${key}`);

    return {
      key,
      url,
      status: 'processing',
      message: 'Video uploaded and queued for processing',
    };
  }

  /**
   * Get signed URL for private content
   */
  async getSignedUrl(contentFileId: string, userId: string): Promise<string> {
    // Get content file
    const contentFile = await this.prisma.contentFile.findUnique({
      where: { id: contentFileId },
      include: {
        content: {
          include: {
            creator: true,
          },
        },
      },
    });

    if (!contentFile) {
      throw new BadRequestException('Content file not found');
    }

    if (!contentFile.content) {
      throw new BadRequestException('Content file is not linked to content');
    }

    // Check access permissions
    const hasAccess = await this.checkAccess(
      userId,
      contentFile.content.creatorId,
      contentFile.content.id,
    );

    if (!hasAccess) {
      throw new BadRequestException('You do not have access to this content');
    }

    // Generate signed URL (expires in 1 hour)
    return this.storageService.getSignedUrl(contentFile.storagePath, 3600);
  }

  /**
   * Check if user has access to content
   */
  private async checkAccess(
    userId: string,
    creatorId: string,
    contentId: string,
  ): Promise<boolean> {
    // Owner always has access
    if (userId === creatorId) {
      return true;
    }

    // Get content details
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      return false;
    }

    // Check if content is public
    if (content.visibility === 'PUBLIC') {
      return true;
    }

    // Check if content is PPV and user has unlocked it
    if (content.isPpv) {
      const unlock = await this.prisma.contentUnlock.findUnique({
        where: {
          contentId_userId: {
            contentId,
            userId,
          },
        },
      });
      return !!unlock;
    }

    // Check if user has active subscription
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        subscriberId: userId,
        tier: {
          creatorId,
        },
        status: 'ACTIVE',
        currentPeriodEnd: {
          gte: new Date(),
        },
      },
    });

    return !!subscription;
  }

  /**
   * Delete media file
   */
  async deleteMedia(contentFileId: string, userId: string): Promise<void> {
    const contentFile = await this.prisma.contentFile.findUnique({
      where: { id: contentFileId },
      include: {
        content: true,
      },
    });

    if (!contentFile) {
      throw new BadRequestException('Content file not found');
    }

    if (!contentFile.content) {
      throw new BadRequestException('Content file is not linked to content');
    }

    // Check ownership
    if (contentFile.content.creatorId !== userId) {
      throw new BadRequestException('You do not own this content');
    }

    // Delete from storage
    await this.storageService.deleteFile(contentFile.storagePath);

    // Delete thumbnail if exists
    if (contentFile.thumbnailPath) {
      await this.storageService.deleteFile(contentFile.thumbnailPath);
    }

    // Delete from database
    await this.prisma.contentFile.delete({
      where: { id: contentFileId },
    });

    this.logger.log(`Media deleted: ${contentFileId}`);
  }
}
