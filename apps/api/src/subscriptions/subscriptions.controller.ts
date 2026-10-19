import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateTierDto, UpdateTierDto } from './dto/subscription-tier.dto';
import { SubscribeDto, ConfirmSubscriptionDto, ChangeTierDto, RetryPaymentDto } from './dto/subscribe.dto';

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

  @Get('creator/:creatorId/status')
  async getSubscriptionStatus(
    @CurrentUser('id') userId: string,
    @Param('creatorId') creatorId: string,
  ) {
    return this.subscriptionsService.getSubscriptionStatus(userId, creatorId);
  }

  // Subscription Lifecycle Routes
  @Post('subscribe')
  async subscribe(
    @CurrentUser('id') userId: string,
    @Body() dto: SubscribeDto,
  ) {
    return this.subscriptionsService.subscribe(userId, dto);
  }

  @Post('confirm')
  async confirmSubscription(
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmSubscriptionDto,
  ) {
    return this.subscriptionsService.confirmSubscription(userId, dto.stripeSubscriptionId);
  }

  @Post(':subscriptionId/cancel')
  async cancelSubscription(
    @CurrentUser('id') userId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.subscriptionsService.cancelSubscription(userId, subscriptionId);
  }

  @Post(':subscriptionId/resume')
  async resumeSubscription(
    @CurrentUser('id') userId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.subscriptionsService.resumeSubscription(userId, subscriptionId);
  }

  // Pay a past-due subscription again (optionally with another saved card)
  @Post(':subscriptionId/retry-payment')
  async retryPayment(
    @CurrentUser('id') userId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: RetryPaymentDto,
  ) {
    return this.subscriptionsService.retryPayment(userId, subscriptionId, dto.paymentMethodId);
  }

  // Upgrade / downgrade to another tier of the same creator
  @Post(':subscriptionId/change-tier')
  async changeTier(
    @CurrentUser('id') userId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: ChangeTierDto,
  ) {
    return this.subscriptionsService.changeTier(userId, subscriptionId, dto);
  }

  // Tier Management Routes
  @Get('my-tiers')
  @Roles('CREATOR')
  @UseGuards(RolesGuard)
  async getMyTiers(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getMyTiers(userId);
  }

  @Post('tiers')
  @Roles('CREATOR')
  @UseGuards(RolesGuard)
  async createTier(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTierDto,
  ) {
    return this.subscriptionsService.createTier(userId, dto);
  }

  @Put('tiers/:tierId')
  @Roles('CREATOR')
  @UseGuards(RolesGuard)
  async updateTier(
    @CurrentUser('id') userId: string,
    @Param('tierId') tierId: string,
    @Body() dto: UpdateTierDto,
  ) {
    return this.subscriptionsService.updateTier(userId, tierId, dto);
  }

  @Delete('tiers/:tierId')
  @Roles('CREATOR')
  @UseGuards(RolesGuard)
  async deleteTier(
    @CurrentUser('id') userId: string,
    @Param('tierId') tierId: string,
  ) {
    return this.subscriptionsService.deleteTier(userId, tierId);
  }
}
