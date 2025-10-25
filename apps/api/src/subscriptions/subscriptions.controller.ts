import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('my-subscriptions')
  async getMySubscriptions(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getUserSubscriptions(userId);
  }

  @Get('my-subscribers')
  @Roles('CREATOR')
  @UseGuards(RolesGuard)
  async getMySubscribers(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getCreatorSubscribers(userId);
  }

  @Get('creator/:creatorId/tiers')
  async getCreatorTiers(@Param('creatorId') creatorId: string) {
    return this.subscriptionsService.getCreatorTiers(creatorId);
  }
}
