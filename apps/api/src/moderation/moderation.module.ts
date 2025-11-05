import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from '../common/database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { ModerationProcessor } from './moderation.processor';
import { ContentModerationService } from './content-moderation.service';
import { SuspensionSchedulerService } from './suspension-scheduler.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'moderation',
    }),
    DatabaseModule,
    NotificationsModule,
  ],
  controllers: [ModerationController],
  providers: [
    ModerationService,
    ModerationProcessor,
    ContentModerationService,
    SuspensionSchedulerService,
  ],
  exports: [ModerationService, ContentModerationService],
})
export class ModerationModule {}
