import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ModerationService } from './moderation.service';
import { ApproveContentDto, CreateReportDto, ModerationDecisionDto, RejectContentDto } from './dto/moderation.dto';
import { ContentService } from '../content/content.service';
import { MediaScanService } from '../media/media-scan/media-scan.service';
import { ThrottleAuth } from '../common/decorators/throttle.decorator';
import { AdminService } from '../admin/admin.service';
import { ReportStatus, ReportType } from '../admin/dto/admin.dto';
import { normalizeReportStatus } from '../admin/report-status.util';

const LEGACY_DECISION_TO_STATUS: Record<string, ReportStatus> = {
  RESOLVE: ReportStatus.RESOLVED,
  DISMISS: ReportStatus.REJECTED,
  ESCALATE: ReportStatus.REVIEWING,
};

interface RequestWithUser {
  // JwtStrategy.validate returns the user row: the id is `id` (there is no `sub`)
  user: { id: string; email: string; role: string };
}

@Controller('moderation')
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(
    private moderationService: ModerationService,
    private adminService: AdminService,
    private contentService: ContentService,
    private mediaScan: MediaScanService,
  ) {}

  // ==================== Pre-publication review ====================
  // Every content is reviewed before it goes live (card network rules for
  // adult content). Stories are not pre-reviewed (24h lifetime): they are
  // gated by KYC, the media scan and reports. Lives are monitored in real
  // time (POST /streaming/:id/moderation/end cuts a live).

  /**
   * Content waiting for review, oldest first, with signed media URLs and the
   * declared co-performers (verification status)
   */
  @Get('content/queue')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async getContentReviewQueue(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.contentService.getContentForModeration(
      page ? Math.max(parseInt(page) || 1, 1) : 1,
      limit ? Math.min(Math.max(parseInt(limit) || 20, 1), 50) : 20,
    );
  }

  @Get('content/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async getContentForReview(@Param('id', ParseUUIDPipe) contentId: string) {
    return this.contentService.getContentForReview(contentId);
  }

  /** Publish (or keep scheduled) content waiting for review */
  @Post('content/:id/approve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async approveContent(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) contentId: string,
    @Body() dto: ApproveContentDto,
  ) {
    return this.contentService.moderateContent(req.user.id, contentId, true, dto?.notes);
  }

  @Post('content/:id/reject')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async rejectContent(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) contentId: string,
    @Body() dto: RejectContentDto,
  ) {
    return this.contentService.moderateContent(req.user.id, contentId, false, dto.reason);
  }

  /** Scan again media still waiting for the known-illegal-media scan */
  @Post('content/:id/rescan')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async rescanContent(@Param('id', ParseUUIDPipe) contentId: string) {
    const result = await this.mediaScan.rescanContent(contentId);
    if (!result) {
      throw new NotFoundException('Content not found');
    }
    return result;
  }

  /**
   * User endpoint: Create a report
   */
  @Post('reports')
  @ThrottleAuth()
  async createReport(@Request() req: RequestWithUser, @Body() dto: CreateReportDto) {
    return this.moderationService.createReport(req.user.id, dto);
  }

  /**
   * User endpoint: Get my reports
   */
  @Get('reports/my')
  async getMyReports(@Request() req: RequestWithUser) {
    // Could implement this to show user their report history
    return { message: 'To be implemented' };
  }

  /**
   * @deprecated Use GET /admin/reports. Kept as an alias returning the same
   * format as the admin API (uppercase statuses, { items, pagination }).
   */
  @Get('reports/queue')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async getReportsQueue(
    @Query('status') status?: string,
    @Query('reportedType') reportedType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getReports({
      status: status ? normalizeReportStatus(status) : undefined,
      type: reportedType ? (reportedType.toUpperCase() as ReportType) : undefined,
      page: page ? parseInt(page) : 1,
      limit: limit ? Math.min(parseInt(limit), 100) : 20,
    });
  }

  /**
   * @deprecated Use POST /admin/reports/handle (decision RESOLVE/DISMISS/ESCALATE maps to
   * RESOLVED/REJECTED/REVIEWING).
   */
  @Post('reports/:id/handle')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async handleReport(
    @Request() req: RequestWithUser,
    @Param('id') reportId: string,
    @Body() body: { decision: 'RESOLVE' | 'DISMISS' | 'ESCALATE'; resolution: string },
  ) {
    const status = LEGACY_DECISION_TO_STATUS[body?.decision];
    if (!status) {
      throw new BadRequestException('decision must be RESOLVE, DISMISS or ESCALATE');
    }
    return this.adminService.handleReport(
      req.user.id,
      { reportId, status, adminNotes: body.resolution },
      req.user.role,
    );
  }

  /**
   * Admin endpoint: Ban user
   */
  @Post('users/:id/ban')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async banUser(
    @Request() req: RequestWithUser,
    @Param('id') userId: string,
    @Body() body: { reason: string },
  ) {
    return this.moderationService.banUser(req.user.id, userId, body.reason);
  }

  /**
   * Admin endpoint: Suspend user
   */
  @Post('users/:id/suspend')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async suspendUser(
    @Request() req: RequestWithUser,
    @Param('id') userId: string,
    @Body() body: { reason: string; durationDays: number },
  ) {
    return this.moderationService.suspendUser(
      req.user.id,
      userId,
      body.reason,
      body.durationDays,
    );
  }

  /**
   * Admin endpoint: Unsuspend user
   */
  @Post('users/:id/unsuspend')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async unsuspendUser(@Param('id') userId: string) {
    return this.moderationService.unsuspendUser(userId, false);
  }
}
