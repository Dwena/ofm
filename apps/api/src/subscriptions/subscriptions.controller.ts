import { Controller, Get, Post, Put, Delete, Param, Body, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { paymentContext } from '../payments/payment-context';
import {
  SubscriptionsService,
  SUBSCRIPTION_STATUSES,
  SubscriptionStatusFilter,
} from './subscriptions.service';
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
  async getMySubscribers(
    @CurrentUser('id') userId: string,
    @Query('status') status?: string,
  ) {
    if (status && !SUBSCRIPTION_STATUSES.includes(status as SubscriptionStatusFilter)) {
      throw new BadRequestException(`status must be one of ${SUBSCRIPTION_STATUSES.join(', ')}`);
    }
    return this.subscriptionsService.getCreatorSubscribers(
      userId,
      status as SubscriptionStatusFilter | undefined,
    );
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
    @Req() request: Request,
  ) {
    return this.subscriptionsService.subscribe(userId, dto, paymentContext(request));
  }

  @Post('confirm')
  async confirmSubscription(
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmSubscriptionDto,
  ) {
    return this.subscriptionsService.confirmSubscription(userId, dto.transactionId);
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
    @Body() dto: RetryPaymentDto,
    @Req() request: Request,
  ) {
    return this.subscriptionsService.resumeSubscription(userId, subscriptionId, dto, paymentContext(request));
  }

  // Pay a past-due subscription again (optionally with another saved card)
  @Post(':subscriptionId/retry-payment')
  async retryPayment(
    @CurrentUser('id') userId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: RetryPaymentDto,
    @Req() request: Request,
  ) {
    return this.subscriptionsService.retryPayment(userId, subscriptionId, dto, paymentContext(request));
  }

  // Upgrade / downgrade to another tier of the same creator
  @Post(':subscriptionId/change-tier')
  async changeTier(
    @CurrentUser('id') userId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: ChangeTierDto,
    @Req() request: Request,
  ) {
    return this.subscriptionsService.changeTier(userId, subscriptionId, dto, paymentContext(request));
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
