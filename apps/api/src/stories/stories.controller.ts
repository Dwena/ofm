import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { StoriesService } from './stories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateStoryDto } from './dto/create-story.dto';
import { ReplyStoryDto } from './dto/reply-story.dto';
import { AgeVerified } from '../age-verification/decorators/age-verified.decorator';
import { gateStories, gateStory, gateStoryGroups } from '../age-verification/age-gate';

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  /**
   * Create a new story (creators only)
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async createStory(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateStoryDto,
  ) {
    return this.storiesService.createStory(userId, dto);
  }

  /**
   * Get stories feed from subscribed creators
   */
  @Get('feed')
  async getStoriesFeed(@CurrentUser('id') userId: string, @AgeVerified() ageVerified: boolean) {
    const groups = await this.storiesService.getStoriesFeed(userId);
    return gateStoryGroups(groups, { viewerId: userId, ageVerified });
  }

  /**
   * Active stories of the current creator (with view/like counts)
   */
  @Get('me')
  async getMyStories(@CurrentUser('id') userId: string) {
    return this.storiesService.getCreatorStories(userId, userId);
  }

  /**
   * Get stories from a specific creator
   */
  @Get('creator/:creatorId')
  async getCreatorStories(
    @Param('creatorId') creatorId: string,
    @CurrentUser('id') userId: string,
    @AgeVerified() ageVerified: boolean,
  ) {
    const stories = await this.storiesService.getCreatorStories(creatorId, userId);
    return gateStories(stories, { viewerId: userId, ageVerified });
  }

  /**
   * Get a single story
   */
  @Get(':id')
  async getStoryById(
    @Param('id') storyId: string,
    @CurrentUser('id') userId: string,
    @AgeVerified() ageVerified: boolean,
  ) {
    const story = await this.storiesService.getStoryById(storyId, userId);
    return gateStory(story, { viewerId: userId, ageVerified });
  }

  /**
   * Mark a story as viewed
   */
  @Post(':id/view')
  async viewStory(
    @CurrentUser('id') userId: string,
    @Param('id') storyId: string,
  ) {
    return this.storiesService.viewStory(userId, storyId);
  }

  /**
   * Like or unlike a story
   */
  @Post(':id/like')
  async toggleLike(
    @CurrentUser('id') userId: string,
    @Param('id') storyId: string,
  ) {
    return this.storiesService.toggleLike(userId, storyId);
  }

  /**
   * Reply to a story (sent as a direct message to the creator)
   */
  @Post(':id/reply')
  async replyToStory(
    @CurrentUser('id') userId: string,
    @Param('id') storyId: string,
    @Body() dto: ReplyStoryDto,
  ) {
    return this.storiesService.replyToStory(userId, storyId, dto.message);
  }

  /**
   * Get viewers of a story (creator only)
   */
  @Get(':id/viewers')
  async getStoryViewers(
    @CurrentUser('id') userId: string,
    @Param('id') storyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.storiesService.getStoryViewers(
      userId,
      storyId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  /**
   * Delete a story (creator only)
   */
  @Delete(':id')
  async deleteStory(
    @CurrentUser('id') userId: string,
    @Param('id') storyId: string,
  ) {
    return this.storiesService.deleteStory(userId, storyId);
  }
}
