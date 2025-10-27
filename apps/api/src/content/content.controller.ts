import { Controller, Get, Post, Put, Delete, Query, Param, Body, UseGuards } from '@nestjs/common';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { SearchContentDto } from './dto/search-content.dto';

@Controller('content')
@UseGuards(JwtAuthGuard)
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get('feed')
  async getFeed(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contentService.getFeed(
      userId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Get('my-content')
  async getMyContent(
    @CurrentUser('id') userId: string,
  ) {
    return this.contentService.getCreatorContent(userId, userId);
  }

  @Get('search')
  async searchContent(
    @CurrentUser('id') userId: string,
    @Query() dto: SearchContentDto,
  ) {
    return this.contentService.searchContent(userId, dto);
  }

  @Get('creator/:creatorId')
  async getCreatorContent(
    @Param('creatorId') creatorId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.contentService.getCreatorContent(creatorId, userId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async createContent(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateContentDto,
  ) {
    return this.contentService.createContent(userId, dto);
  }

  @Get(':id')
  async getContentById(
    @Param('id') contentId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.contentService.getContentById(contentId, userId);
  }

  @Put(':id')
  async updateContent(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.contentService.updateContent(userId, contentId, dto);
  }

  @Post(':id/publish')
  async publishContent(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
  ) {
    return this.contentService.publishContent(userId, contentId);
  }

  @Delete(':id')
  async deleteContent(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
  ) {
    return this.contentService.deleteContent(userId, contentId);
  }

  // Admin routes
  @Get('moderation/queue')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async getModerationQueue(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contentService.getContentForModeration(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Post('moderation/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async moderateContent(
    @CurrentUser('id') adminId: string,
    @Param('id') contentId: string,
    @Body() body: { approved: boolean; notes?: string },
  ) {
    return this.contentService.moderateContent(
      adminId,
      contentId,
      body.approved,
      body.notes,
    );
  }
}
