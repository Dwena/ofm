import { Controller, Get, Post, Put, Delete, Query, Param, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { SearchContentDto } from './dto/search-content.dto';
import { MyContentQueryDto } from './dto/my-content.dto';
import { ConfirmPaymentDto, OneTimePaymentDto } from '../payments/dto/payments.dto';
import { paymentContext } from '../payments/payment-context';
import { AgeVerified } from '../age-verification/decorators/age-verified.decorator';
import { gateContentItem, gateContentItems, gateContentPage } from '../age-verification/age-gate';

@Controller('content')
@UseGuards(JwtAuthGuard)
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get('feed')
  async getFeed(
    @CurrentUser('id') userId: string,
    @AgeVerified() ageVerified: boolean,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const items = await this.contentService.getFeed(
      userId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
    return gateContentItems(items, { viewerId: userId, ageVerified });
  }

  @Get('feed/subscriptions')
  async getSubscriptionsFeed(
    @CurrentUser('id') userId: string,
    @AgeVerified() ageVerified: boolean,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const items = await this.contentService.getSubscriptionsFeed(
      userId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
    return gateContentItems(items, { viewerId: userId, ageVerified });
  }

  /**
   * Authenticated creator's content (every status) with per-content stats
   */
  @Get('my-content')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async getMyContent(
    @CurrentUser('id') userId: string,
    @Query() query: MyContentQueryDto,
  ) {
    return this.contentService.getMyContent(userId, query);
  }

  @Get('search')
  async searchContent(
    @CurrentUser('id') userId: string,
    @Query() dto: SearchContentDto,
    @AgeVerified() ageVerified: boolean,
  ) {
    const page = await this.contentService.searchContent(userId, dto);
    return gateContentPage(page, { viewerId: userId, ageVerified });
  }

  @Get('creator/:creatorId')
  async getCreatorContent(
    @Param('creatorId') creatorId: string,
    @CurrentUser('id') userId: string,
    @AgeVerified() ageVerified: boolean,
  ) {
    const items = await this.contentService.getCreatorContent(creatorId, userId);
    return gateContentItems(items, { viewerId: userId, ageVerified });
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
    @AgeVerified() ageVerified: boolean,
  ) {
    const content = await this.contentService.getContentById(contentId, userId);
    return gateContentItem(content, { viewerId: userId, ageVerified });
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

  @Post(':id/archive')
  async archiveContent(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
  ) {
    return this.contentService.archiveContent(userId, contentId);
  }

  @Post(':id/unarchive')
  async unarchiveContent(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
  ) {
    return this.contentService.unarchiveContent(userId, contentId);
  }

  @Delete(':id')
  async deleteContent(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
  ) {
    return this.contentService.deleteContent(userId, contentId);
  }

  // Moderation routes (pre-publication review; same as GET/POST /moderation/content/...)
  @Get('moderation/queue')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
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
  @Roles('ADMIN', 'MODERATOR')
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

  // Likes endpoints
  @Post(':id/like')
  async toggleLike(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
  ) {
    return this.contentService.toggleLike(userId, contentId);
  }

  // PPV endpoints
  /**
   * Start a PPV purchase: completes right away with a saved card, or returns
   * the provider's payment page to redirect to (redirectUrl)
   */
  @Post(':id/unlock')
  async unlockContent(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
    @Body() dto: OneTimePaymentDto,
    @Req() request: Request,
  ) {
    return this.contentService.unlockContent(userId, contentId, { ...dto, ...paymentContext(request) });
  }

  /**
   * State of the PPV payment once back from the provider's page (idempotent)
   */
  @Post(':id/unlock/confirm')
  async confirmUnlock(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.contentService.confirmUnlock(userId, contentId, dto.transactionId);
  }

  @Get(':id/likes')
  async getLikes(
    @Param('id') contentId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contentService.getLikes(
      contentId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Get(':id/liked')
  async hasUserLiked(
    @CurrentUser('id') userId: string,
    @Param('id') contentId: string,
  ) {
    const liked = await this.contentService.hasUserLiked(userId, contentId);
    return { liked };
  }
}
