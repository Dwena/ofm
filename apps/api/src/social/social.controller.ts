import { Controller, Get, Post, Put, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { SocialService } from './social.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateCommentDto,
  UpdateCommentDto,
  GetCommentsDto,
  FollowCreatorDto,
  DiscoverCreatorsDto,
  SearchCreatorsDto,
} from './dto/social.dto';

@Controller('social')
@UseGuards(JwtAuthGuard)
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  // ==================== Comments ====================

  /**
   * Create a comment
   */
  @Post('comments')
  async createComment(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.socialService.createComment(userId, dto);
  }

  /**
   * Get comments for content
   */
  @Get('comments')
  async getComments(@Query() dto: GetCommentsDto) {
    return this.socialService.getComments(dto);
  }

  /**
   * Update a comment
   */
  @Put('comments/:id')
  async updateComment(
    @CurrentUser('id') userId: string,
    @Param('id') commentId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.socialService.updateComment(userId, commentId, dto);
  }

  /**
   * Delete a comment
   */
  @Delete('comments/:id')
  async deleteComment(
    @CurrentUser('id') userId: string,
    @Param('id') commentId: string,
  ) {
    return this.socialService.deleteComment(userId, commentId);
  }

  // ==================== Follow ====================

  /**
   * Follow a creator
   */
  @Post('follow')
  async followCreator(
    @CurrentUser('id') userId: string,
    @Body() dto: FollowCreatorDto,
  ) {
    return this.socialService.followCreator(userId, dto);
  }

  /**
   * Unfollow a creator
   */
  @Delete('follow/:creatorId')
  async unfollowCreator(
    @CurrentUser('id') userId: string,
    @Param('creatorId') creatorId: string,
  ) {
    return this.socialService.unfollowCreator(userId, creatorId);
  }

  /**
   * Follow status for a creator
   */
  @Get('follow/:creatorId')
  async getFollowStatus(
    @CurrentUser('id') userId: string,
    @Param('creatorId') creatorId: string,
  ) {
    return this.socialService.getFollowStatus(userId, creatorId);
  }

  /**
   * Get following list (creators followed by the current user)
   */
  @Get('following')
  async getFollowing(@CurrentUser('id') userId: string) {
    return this.socialService.getFollowing(userId);
  }

  // ==================== Discovery ====================

  /**
   * Discover creators
   */
  @Get('discover/creators')
  async discoverCreators(
    @CurrentUser('id') userId: string,
    @Query() dto: DiscoverCreatorsDto,
  ) {
    return this.socialService.discoverCreators(userId, dto);
  }

  /**
   * Search creators by username or display name
   */
  @Get('search')
  async searchCreators(@Query() dto: SearchCreatorsDto) {
    return this.socialService.searchCreators(dto);
  }
}
