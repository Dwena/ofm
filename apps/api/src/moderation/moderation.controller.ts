import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ModerationService } from './moderation.service';
import { CreateReportDto, ModerationDecisionDto } from './dto/moderation.dto';
import { ThrottleAuth } from '../common/decorators/throttle.decorator';

interface RequestWithUser {
  user: { sub: string; email: string; role: string };
}

@Controller('moderation')
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private moderationService: ModerationService) {}

  /**
   * User endpoint: Create a report
   */
  @Post('reports')
  @ThrottleAuth()
  async createReport(@Request() req: RequestWithUser, @Body() dto: CreateReportDto) {
    return this.moderationService.createReport(req.user.sub, dto);
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
   * Admin endpoint: Get reports queue
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
    return this.moderationService.getReportsQueue({
      status,
      reportedType,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  /**
   * Admin endpoint: Handle a report
   */
  @Post('reports/:id/handle')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async handleReport(
    @Request() req: RequestWithUser,
    @Param('id') reportId: string,
    @Body() body: { decision: 'RESOLVE' | 'DISMISS' | 'ESCALATE'; resolution: string },
  ) {
    return this.moderationService.handleReport(
      req.user.sub,
      reportId,
      body.decision,
      body.resolution,
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
    return this.moderationService.banUser(req.user.sub, userId, body.reason);
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
      req.user.sub,
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
