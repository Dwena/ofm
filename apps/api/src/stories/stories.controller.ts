import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { StoriesService } from './stories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateStoryDto } from './dto/create-story.dto';

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
  async getStoriesFeed(@CurrentUser('id') userId: string) {
    return this.storiesService.getStoriesFeed(userId);
  }

  /**
   * Get stories from a specific creator
   */
  @Get('creator/:creatorId')
  async getCreatorStories(
    @Param('creatorId') creatorId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.storiesService.getCreatorStories(creatorId, userId);
  }

  /**
   * Get a single story
   */
  @Get(':id')
  async getStoryById(
    @Param('id') storyId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.storiesService.getStoryById(storyId, userId);
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
