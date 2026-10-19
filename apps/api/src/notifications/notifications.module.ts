import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushNotificationsService } from './push-notifications.service';
import { PushNotificationsController } from './push-notifications.controller';

@Module({
  controllers: [PushNotificationsController, NotificationsController],
  providers: [NotificationsService, PushNotificationsService],
  exports: [NotificationsService, PushNotificationsService],
})
export class NotificationsModule {}
