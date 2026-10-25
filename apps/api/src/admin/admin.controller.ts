import { Controller, Get, Post, Put, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ModerateUserDto,
  CreateReportDto,
  HandleReportDto,
  GetReportsDto,
  GetUsersDto,
  GetPlatformStatsDto,
  GetAdminContentDto,
  ModerateContentDto,
  DeleteUserDto,
  GetAuditLogsDto,
  GetAnalyticsDto,
  GetModerationStatsDto,
  ReviewKycDto,
} from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly analyticsService: AdminAnalyticsService,
  ) {}

  // ==================== User Management ====================

  /**
   * Get all users with filters
   */
  @Get('users')
  async getUsers(@Query() dto: GetUsersDto) {
    return this.adminService.getUsers(dto);
  }

  /**
   * Get user details
   */
  @Get('users/:id')
  async getUserDetails(@Param('id') userId: string) {
    return this.adminService.getUserDetails(userId);
  }

  /**
   * Moderate user (suspend, ban, activate)
   */
  @Post('users/moderate')
  async moderateUser(
    @CurrentUser('id') adminId: string,
    @Body() dto: ModerateUserDto,
  ) {
    return this.adminService.moderateUser(adminId, dto);
  }

  /**
   * Approve or reject a pending identity verification (KYC). Moderators
   * review identity documents too (queue: GET /admin/verification/kyc).
   */
  @Post('users/:id/kyc')
  @Roles('ADMIN', 'MODERATOR')
  async reviewKyc(
    @CurrentUser('id') adminId: string,
    @Param('id') userId: string,
    @Body() dto: ReviewKycDto,
  ) {
    return this.adminService.reviewKyc(adminId, userId, dto);
  }

  /**
   * Delete user (permanent)
   */
  @Delete('users/:id')
  async deleteUser(
    @CurrentUser('id') adminId: string,
    @Param('id') userId: string,
    @Body() body: DeleteUserDto,
  ) {
    return this.adminService.deleteUser(adminId, userId, body?.reason);
  }

  // ==================== Content Management ====================

  /**
   * List content (all, flagged or removed) for moderation
   */
  @Get('content')
  async getContent(@Query() dto: GetAdminContentDto) {
    return this.adminService.getContent(dto);
  }

  /**
   * Remove content (moderation takedown)
   */
  @Post('content/:id/remove')
  async removeContent(
    @CurrentUser('id') adminId: string,
    @Param('id') contentId: string,
    @Body() dto: ModerateContentDto,
  ) {
    return this.adminService.removeContent(adminId, contentId, dto.reason);
  }

  /**
   * Restore removed content
   */
  @Post('content/:id/restore')
  async restoreContent(
    @CurrentUser('id') adminId: string,
    @Param('id') contentId: string,
    @Body() dto: ModerateContentDto,
  ) {
    return this.adminService.restoreContent(adminId, contentId, dto.reason);
  }

  // ==================== Reports Management ====================

  /**
   * Get reports with filters (moderators can triage reports too)
   */
  @Get('reports')
  @Roles('ADMIN', 'MODERATOR')
  async getReports(@Query() dto: GetReportsDto) {
    return this.adminService.getReports(dto);
  }

  /**
   * Handle report (resolve, reject)
   */
  @Post('reports/handle')
  @Roles('ADMIN', 'MODERATOR')
  async handleReport(
    @CurrentUser('id') adminId: string,
    @CurrentUser('role') role: string,
    @Body() dto: HandleReportDto,
  ) {
    return this.adminService.handleReport(adminId, dto, role);
  }

  /**
   * Moderation statistics: reports over time, handling time, actions taken
   */
  @Get('moderation/stats')
  @Roles('ADMIN', 'MODERATOR')
  async getModerationStats(@Query() dto: GetModerationStatsDto) {
    return this.analyticsService.getModerationStats(dto);
  }

  // ==================== Platform Statistics ====================

  /**
   * Get platform statistics
   */
  @Get('stats/platform')
  async getPlatformStats(@Query() dto: GetPlatformStatsDto) {
    return this.adminService.getPlatformStats(dto);
  }

  /**
   * Platform analytics time series (revenue, fees, users, content, subscriptions, top creators)
   */
  @Get('stats/analytics')
  async getAnalytics(@Query() dto: GetAnalyticsDto) {
    return this.analyticsService.getAnalytics(dto);
  }

  /**
   * Get activity logs
   */
  @Get('activity-logs')
  async getActivityLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getActivityLogs(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  /**
   * Get audit logs (admin & moderation actions)
   */
  @Get('audit-logs')
  async getAuditLogs(@Query() dto: GetAuditLogsDto) {
    return this.adminService.getAuditLogs(dto);
  }
}
