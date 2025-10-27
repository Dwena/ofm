import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateTierDto, UpdateTierDto } from './dto/subscription-tier.dto';

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
