import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { LiveTipsService } from './live-tips.service';
import { StreamingGateway } from './streaming.gateway';
import { ReplaceTipMenuDto, UpdateTipGoalDto } from './dto/tip-menu.dto';

/**
 * Tip menu ("paliers de dons") and tip goal of the live streams
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
    return this.liveTips.replaceMenu(userId, dto);
  }

  /**
   * Active items of a creator's tip menu
   */
  @Get('creators/:creatorId/tip-menu')
  async getCreatorTipMenu(@Param('creatorId') creatorId: string) {
    return this.liveTips.getActiveMenu(creatorId);
  }

  /**
   * Set or clear (amount: null) the tip goal of a stream (creator only)
   */
  @Patch(':id/tip-goal')
  async updateTipGoal(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
    @Body() dto: UpdateTipGoalDto,
  ) {
    const goal = await this.liveTips.setTipGoal(userId, streamId, dto);
    this.streamingGateway.notifyTipGoalUpdated(goal);
    return goal;
  }
}
