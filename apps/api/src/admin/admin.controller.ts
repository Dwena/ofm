import { Controller, Get, Post, Put, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
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
} from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
   * Delete user (permanent)
   */
  @Delete('users/:id')
  async deleteUser(
    @CurrentUser('id') adminId: string,
    @Param('id') userId: string,
    @Body() body: { reason: string },
  ) {
    return this.adminService.deleteUser(adminId, userId, body.reason);
  }

  // ==================== Reports Management ====================

  /**
   * Get reports with filters
   */
  @Get('reports')
  async getReports(@Query() dto: GetReportsDto) {
    return this.adminService.getReports(dto);
  }

  /**
   * Handle report (resolve, reject)
   */
  @Post('reports/handle')
  async handleReport(
    @CurrentUser('id') adminId: string,
    @Body() dto: HandleReportDto,
  ) {
    return this.adminService.handleReport(adminId, dto);
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
}
