import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/database/prisma.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { MessagingService } from '../messaging/messaging.service';
import { MessagingGateway } from '../messaging/messaging.gateway';

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    private prisma: PrismaService,
    private messagingService: MessagingService,
    private messagingGateway: MessagingGateway,
  ) {}

  /**
   * Create a new story (expires in 24h)
   */
  async createStory(userId: string, dto: CreateStoryDto) {
    // Verify user is a creator
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can create stories');
    }

    // Validate content
    if (dto.type === 'TEXT' && !dto.text) {
      throw new BadRequestException('Text stories must have text content');
    }

    if ((dto.type === 'PHOTO' || dto.type === 'VIDEO') && !dto.mediaUrl) {
      throw new BadRequestException('Photo/Video stories must have a media URL');
    }

    // Set expiration to 24h from now
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const story = await this.prisma.story.create({
      data: {
        creatorId: userId,
        type: dto.type,
        mediaUrl: dto.mediaUrl,
        thumbnailUrl: dto.thumbnailUrl,
        text: dto.text,
        caption: dto.caption,
        duration: dto.duration,
        width: dto.width,
        height: dto.height,
        visibility: dto.visibility || 'SUBSCRIBERS_ONLY',
        expiresAt,
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    this.logger.log(`Story created: ${story.id} by user ${userId}`);
    return story;
  }

  /**
   * Get active stories from subscribed creators (and the user's own stories),
   * grouped by creator. Each story carries `isViewed` for the current user and
   * each group `hasUnviewed`; the user's own group leads, then groups with
   * unseen stories.
   */
  async getStoriesFeed(userId: string) {
    // Get subscriptions
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        subscriberId: userId,
        status: 'ACTIVE',
      },
      select: {
        tier: {
          select: {
            creatorId: true,
          },
        },
      },
    });

    const creatorIds = Array.from(
      new Set([userId, ...subscriptions.map((sub: any) => sub.tier.creatorId)]),
    );

    // Get active stories (not expired, not deleted)
    const stories = await this.prisma.story.findMany({
      where: {
        creatorId: {
          in: creatorIds,
        },
        expiresAt: {
          gt: new Date(),
        },
        deletedAt: null,
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        views: {
          where: { viewerId: userId },
          select: { id: true },
          take: 1,
        },
        _count: {
          select: {
            views: true,
            likes: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Group stories by creator
    const grouped = new Map<string, { creator: any; stories: any[]; hasUnviewed: boolean; isOwn: boolean }>();
    for (const { views, ...story } of stories as any[]) {
      const isOwn = story.creatorId === userId;
      const isViewed = isOwn || (views?.length ?? 0) > 0;
      let group = grouped.get(story.creatorId);
      if (!group) {
        group = { creator: story.creator, stories: [], hasUnviewed: false, isOwn };
        grouped.set(story.creatorId, group);
      }
      group.stories.push({ ...story, isViewed });
      if (!isViewed) group.hasUnviewed = true;
    }

    return Array.from(grouped.values()).sort((a, b) => {
      if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
      if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
      return 0;
    });
  }

  /**
   * Get stories from a specific creator
   */
  async getCreatorStories(creatorId: string, userId?: string) {
    const stories = await this.prisma.story.findMany({
      where: {
        creatorId,
        expiresAt: {
          gt: new Date(),
        },
        deletedAt: null,
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            views: true,
            likes: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return this.withLikeStatus(stories, userId);
  }

  /**
   * Get a single story by ID
   */
  async getStoryById(storyId: string, userId?: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            views: true,
            likes: true,
          },
        },
      },
    });

    if (!story || story.deletedAt) {
      throw new NotFoundException('Story not found');
    }

    if (story.expiresAt < new Date()) {
      throw new NotFoundException('Story has expired');
    }

    const [withStatus] = await this.withLikeStatus([story], userId);
    return withStatus;
  }

  /**
   * Mark a story as viewed
   */
  async viewStory(userId: string, storyId: string) {
    // Verify story exists and is active
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, expiresAt: true, deletedAt: true, creatorId: true },
    });

    if (!story || story.deletedAt) {
      throw new NotFoundException('Story not found');
    }

    if (story.expiresAt < new Date()) {
      throw new NotFoundException('Story has expired');
    }

    // Don't track views from the creator themselves
    if (story.creatorId === userId) {
      return { message: 'Story view tracked' };
    }

    // Check if already viewed
    const existingView = await this.prisma.storyView.findUnique({
      where: {
        storyId_viewerId: {
          storyId,
          viewerId: userId,
        },
      },
    });

    if (!existingView) {
      // Create view record and increment count
      await this.prisma.$transaction([
        this.prisma.storyView.create({
          data: {
            storyId,
            viewerId: userId,
          },
        }),
        this.prisma.story.update({
          where: { id: storyId },
          data: { viewCount: { increment: 1 } },
        }),
      ]);

      this.logger.log(`Story viewed: ${storyId} by user ${userId}`);
    }

    return { message: 'Story view tracked' };
  }

  /**
   * Like or unlike a story
   */
  async toggleLike(userId: string, storyId: string) {
    await this.getActiveStory(storyId);

    const existingLike = await this.prisma.storyLike.findUnique({
      where: {
        storyId_userId: {
          storyId,
          userId,
        },
      },
    });

    if (existingLike) {
      await this.prisma.storyLike.delete({
        where: { id: existingLike.id },
      });
    } else {
      await this.prisma.storyLike.create({
        data: {
          storyId,
          userId,
        },
      });
    }

    const likesCount = await this.prisma.storyLike.count({ where: { storyId } });

    this.logger.log(`Story ${existingLike ? 'unliked' : 'liked'}: ${storyId} by user ${userId}`);
    return { liked: !existingLike, likesCount };
  }

  /**
   * Reply to a story: delivered to the creator as a direct message
   */
  async replyToStory(userId: string, storyId: string, text: string) {
    const story = await this.getActiveStory(storyId);

    if (story.creatorId === userId) {
      throw new BadRequestException('You cannot reply to your own story');
    }

    const creatorProfile = await this.prisma.creatorProfile.findUnique({
      where: { userId: story.creatorId },
      select: { allowMessages: true },
    });

    if (creatorProfile && !creatorProfile.allowMessages) {
      throw new ForbiddenException('This creator does not accept messages');
    }

    const message = await this.messagingService.sendMessage(
      userId,
      story.creatorId,
      `[Réponse à votre story] ${text.trim()}`,
    );

    // Real-time delivery if the creator is connected
    this.messagingGateway.emitNewMessage(
      story.creatorId,
      this.messagingGateway.toMessagePayload(message),
    );

    this.logger.log(`Story reply: ${storyId} by user ${userId}`);
    return message;
  }

  /**
   * Get viewers of a story (creator only)
   */
  async getStoryViewers(userId: string, storyId: string, page: number = 1, limit: number = 50) {
    // Verify story exists and belongs to user
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { creatorId: true },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (story.creatorId !== userId) {
      throw new ForbiddenException('You can only view your own story viewers');
    }

    const skip = (page - 1) * limit;

    const [views, total] = await Promise.all([
      this.prisma.storyView.findMany({
        where: { storyId },
        include: {
          viewer: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
        orderBy: {
          viewedAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.storyView.count({ where: { storyId } }),
    ]);

    return {
      items: views,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Delete a story (creator only)
   */
  async deleteStory(userId: string, storyId: string) {
    // Verify story exists and belongs to user
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { creatorId: true },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (story.creatorId !== userId) {
      throw new ForbiddenException('You can only delete your own stories');
    }

    // Soft delete
    await this.prisma.story.update({
      where: { id: storyId },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Story deleted: ${storyId} by user ${userId}`);
    return { message: 'Story deleted successfully' };
  }

  /**
   * Load a story that is neither deleted nor expired
   */
  private async getActiveStory(storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, expiresAt: true, deletedAt: true, creatorId: true },
    });

    if (!story || story.deletedAt) {
      throw new NotFoundException('Story not found');
    }

    if (story.expiresAt < new Date()) {
      throw new NotFoundException('Story has expired');
    }

    return story;
  }

  /**
   * Attach whether the viewer liked each story
   */
  private async withLikeStatus<T extends { id: string }>(stories: T[], userId?: string) {
    if (!userId || stories.length === 0) {
      return stories.map((story) => ({ ...story, isLiked: false }));
    }

    const likes = await this.prisma.storyLike.findMany({
      where: {
        userId,
        storyId: { in: stories.map((story) => story.id) },
      },
      select: { storyId: true },
    });

    const likedIds = new Set(likes.map((like: any) => like.storyId));
    return stories.map((story) => ({ ...story, isLiked: likedIds.has(story.id) }));
  }

  /**
   * Cron job to delete expired stories (runs every hour)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredStories() {
    const now = new Date();

    const result = await this.prisma.story.deleteMany({
      where: {
        expiresAt: {
          lt: now,
        },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired stories`);
    }
  }
}
