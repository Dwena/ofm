import { Body, Controller, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { LiveTipsService } from './live-tips.service';
import { StreamingGateway } from './streaming.gateway';
import {
  LatestTipGoalsQueryDto,
  ReplaceTipGoalsDto,
  ReplaceTipMenuDto,
  UpdateTipGoalStatusDto,
} from './dto/tip-menu.dto';

/**
 * Tip menu ("paliers de dons") and donation goals (milestones) of the live streams
 */
@Controller('streaming')
@UseGuards(JwtAuthGuard)
export class LiveTipsController {
  constructor(
    private readonly liveTips: LiveTipsService,
    private readonly streamingGateway: StreamingGateway,
  ) {}

  /**
   * The creator's own tip menu (active and hidden items)
   */
  @Get('me/tip-menu')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async getOwnTipMenu(@CurrentUser('id') userId: string) {
    return this.liveTips.getOwnMenu(userId);
  }

  /**
   * Replace the creator's whole tip menu
   */
  @Put('me/tip-menu')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async replaceTipMenu(@CurrentUser('id') userId: string, @Body() dto: ReplaceTipMenuDto) {
    const menu = await this.liveTips.replaceMenu(userId, dto);
    // The OBS tip menu overlay shows the new menu right away
    this.streamingGateway.notifyTipMenuUpdated(userId, menu.items);
    return menu;
  }

  /**
   * Milestones of the creator's most recent live that has some ("Reprendre
   * les paliers de mon dernier live")
   */
  @Get('me/tip-goals/latest')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async getLatestTipGoals(@CurrentUser('id') userId: string, @Query() query: LatestTipGoalsQueryDto) {
    return this.liveTips.getLatestGoals(userId, query.excludeStreamId);
  }

  /**
   * Active items of a creator's tip menu
   */
  @Get('creators/:creatorId/tip-menu')
  async getCreatorTipMenu(@Param('creatorId') creatorId: string) {
    return this.liveTips.getActiveMenu(creatorId);
  }

  /**
   * Replace the milestones of a scheduled or live stream (creator only)
   */
  @Put(':id/tip-goals')
  async replaceTipGoals(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
    @Body() dto: ReplaceTipGoalsDto,
  ) {
    const snapshot = await this.liveTips.replaceGoals(userId, streamId, dto);
    this.streamingGateway.notifyTipGoalsUpdated(snapshot);
    return snapshot;
  }

  /**
   * Mark a reached milestone as done or not (creator only)
   */
  @Patch(':id/tip-goals/:goalId')
  async updateTipGoal(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
    @Param('goalId') goalId: string,
    @Body() dto: UpdateTipGoalStatusDto,
  ) {
    const result = await this.liveTips.setGoalCompleted(userId, streamId, goalId, dto.completed);
    this.streamingGateway.notifyTipGoalUpdated(result);
    return result;
  }
}
