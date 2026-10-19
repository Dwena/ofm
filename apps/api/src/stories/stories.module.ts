import { Module } from '@nestjs/common';
import { StoriesService } from './stories.service';
import { StoriesController } from './stories.controller';
import { MessagingModule } from '../messaging/messaging.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [MessagingModule, StorageModule],
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
