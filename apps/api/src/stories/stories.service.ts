import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/database/prisma.service';
import { CreateStoryDto } from './dto/create-story.dto';

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(private prisma: PrismaService) {}

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
   * Get active stories from subscribed creators
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

    const creatorIds = subscriptions.map((sub: any) => sub.tier.creatorId);

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
        _count: {
          select: {
            views: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Group stories by creator
    const grouped = stories.reduce((acc: any, story: any) => {
      const creatorId = story.creatorId;
      if (!acc[creatorId]) {
        acc[creatorId] = {
          creator: story.creator,
          stories: [],
        };
      }
      acc[creatorId].stories.push(story);
      return acc;
    }, {});

    return Object.values(grouped);
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
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return stories;
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

    return story;
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
