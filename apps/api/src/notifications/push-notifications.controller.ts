import { Body, Controller, Delete, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { PushNotificationsService } from './push-notifications.service';
import { CreatePushSubscriptionDto, RemovePushSubscriptionDto } from './dto/push-subscription.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('notifications/push')
export class PushNotificationsController {
  constructor(private readonly pushService: PushNotificationsService) {}

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return this.pushService.getVapidPublicKey();
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async subscribe(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.pushService.subscribe(userId, dto, userAgent);
  }

  @Delete('unsubscribe')
  @UseGuards(JwtAuthGuard)
  async unsubscribe(
    @CurrentUser('id') userId: string,
    @Body() dto: RemovePushSubscriptionDto,
  ) {
    return this.pushService.unsubscribe(userId, dto.endpoint);
  }
}
