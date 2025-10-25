import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

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

  @Get('creator/:creatorId')
  async getCreatorContent(
    @Param('creatorId') creatorId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.contentService.getCreatorContent(creatorId, userId);
  }
}
