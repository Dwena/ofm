import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  TrackViewDto,
  GetAnalyticsDto,
  GetContentAnalyticsDto,
  GetEngagementDto,
} from './dto/analytics.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Track content view
   */
  @Post('track/view')
  async trackView(@Body() dto: TrackViewDto) {
    return this.analyticsService.trackView(dto);
  }

  /**
   * Get overview analytics
   */
  @Get('overview')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async getOverview(@CurrentUser('id') userId: string) {
    return this.analyticsService.getOverview(userId);
  }

  /**
   * Get content analytics
   */
  @Get('content')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async getContentAnalytics(
    @CurrentUser('id') userId: string,
    @Query() dto: GetContentAnalyticsDto,
  ) {
    return this.analyticsService.getContentAnalytics(userId, dto);
  }

  /**
   * Get engagement statistics
   */
  @Get('engagement')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async getEngagementStats(
    @CurrentUser('id') userId: string,
    @Query() dto: GetEngagementDto,
  ) {
    return this.analyticsService.getEngagementStats(userId, dto);
  }

  /**
   * Get subscriber growth
   */
  @Get('subscribers/growth')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async getSubscriberGrowth(
    @CurrentUser('id') userId: string,
    @Query() dto: GetAnalyticsDto,
  ) {
    return this.analyticsService.getSubscriberGrowth(userId, dto);
  }

  /**
   * Get detailed report
   */
  @Get('report/detailed')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async getDetailedReport(
    @CurrentUser('id') userId: string,
    @Query() dto: GetAnalyticsDto,
  ) {
    return this.analyticsService.getDetailedReport(userId, dto);
  }
}
