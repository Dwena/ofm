/**
 * Media Module
 * Handles image and video processing with Bull queues
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';

import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { ImageProcessor } from './processors/image.processor';
import { VideoProcessor } from './processors/video.processor';
import { MediaValidator } from './validators/media.validator';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    StorageModule,
    BullModule.registerQueue(
      { name: 'image-processing' },
      { name: 'video-processing' },
    ),
  ],
  controllers: [MediaController],
  providers: [MediaService, ImageProcessor, VideoProcessor, MediaValidator],
  exports: [MediaService],
})
export class MediaModule {}
