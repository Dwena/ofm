import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { MessagingService } from '../messaging/messaging.service';
import { MessagingGateway } from '../messaging/messaging.gateway';

const CREATOR_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
} as const;

const STORY_INCLUDE = {
  creator: { select: CREATOR_SELECT },
  _count: {
    select: {
      views: true,
      likes: true,
    },
  },
} as const;

interface AccessCheckedStory {
  id: string;
  creatorId: string;
  visibility: string;
}

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
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

    const text = dto.text?.trim() || null;
    const caption = dto.caption?.trim() || null;

    // Validate content
    if (dto.type === 'TEXT' && !text) {
      throw new BadRequestException('Text stories must have text content');
    }

    if ((dto.type === 'PHOTO' || dto.type === 'VIDEO') && !dto.mediaUrl) {
      throw new BadRequestException('Photo/Video stories must have a media URL');
    }

    const isMediaStory = dto.type !== 'TEXT';
    if (isMediaStory) {
      this.assertOwnMedia(userId, dto.mediaUrl);
      this.assertOwnMedia(userId, dto.thumbnailUrl);
    }

    // Set expiration to 24h from now
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const story = await this.prisma.story.create({
      data: {
        creatorId: userId,
        type: dto.type,
        mediaUrl: isMediaStory ? dto.mediaUrl : null,
        thumbnailUrl: isMediaStory ? dto.thumbnailUrl : null,
        text: isMediaStory ? null : text,
        caption,
        backgroundColor: isMediaStory ? null : dto.backgroundColor ?? null,
        duration: dto.duration,
        width: dto.width,
        height: dto.height,
        visibility: dto.visibility || 'SUBSCRIBERS_ONLY',
        expiresAt,
      },
      include: STORY_INCLUDE,
    });

    this.logger.log(`Story created: ${story.id} by user ${userId}`);
    const [presented] = await this.presentStories([story], userId);
    return presented;
  }

  /**
   * Active stories grouped by creator: the viewer's own stories, stories from
   * creators they subscribe to and public stories from creators they follow.
   * Groups with unseen stories come first; stories are in chronological order.
   */
  async getStoriesFeed(userId: string) {
    const [subscriptions, follows] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          subscriberId: userId,
          status: 'ACTIVE',
          currentPeriodEnd: { gte: new Date() },
        },
        select: {
          tier: {
            select: {
              creatorId: true,
            },
          },
        },
      }),
      this.prisma.follow.findMany({
        where: { followerId: userId },
        select: { creatorId: true },
      }),
    ]);

    const subscribedIds = Array.from(new Set(subscriptions.map((sub: any) => sub.tier.creatorId)));
    const followedIds = follows
      .map((follow: any) => follow.creatorId)
      .filter((id: string) => !subscribedIds.includes(id));

    // Get active stories (not expired, not deleted)
    const stories = await this.prisma.story.findMany({
      where: {
        expiresAt: {
          gt: new Date(),
        },
        deletedAt: null,
        OR: [
          { creatorId: userId },
          { creatorId: { in: subscribedIds }, visibility: { not: 'PRIVATE' } },
          { creatorId: { in: followedIds }, visibility: 'PUBLIC' },
        ],
      },
      include: STORY_INCLUDE,
      orderBy: {
        createdAt: 'asc',
      },
    });

    const presented = await this.presentStories(stories, userId, new Set(subscribedIds));

    // Group stories by creator
    const grouped = new Map<string, { creator: any; stories: any[]; hasUnviewed: boolean; latestAt: Date }>();
    for (const story of presented) {
      const group = grouped.get(story.creatorId) ?? {
        creator: story.creator,
        stories: [],
        hasUnviewed: false,
        latestAt: story.createdAt,
      };
      group.stories.push(story);
      if (!story.isViewed) group.hasUnviewed = true;
      if (story.createdAt > group.latestAt) group.latestAt = story.createdAt;
      grouped.set(story.creatorId, group);
    }

    return Array.from(grouped.values())
      .map((group) => ({ ...group, isOwn: group.creator?.id === userId }))
      .sort((a, b) => {
        if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
        if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
        return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
      });
  }

  /**
   * Active stories of a specific creator, in chronological order.
   * Subscriber-only stories are returned locked (no media) to non-subscribers.
   */
  async getCreatorStories(creatorId: string, userId?: string) {
    const stories = await this.prisma.story.findMany({
      where: {
        creatorId,
        expiresAt: {
          gt: new Date(),
        },
        deletedAt: null,
        ...(creatorId === userId ? {} : { visibility: { not: 'PRIVATE' } }),
      },
      include: STORY_INCLUDE,
      orderBy: {
        createdAt: 'asc',
      },
    });

    return this.presentStories(stories, userId);
  }

  /**
   * Get a single story by ID
   */
  async getStoryById(storyId: string, userId?: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: STORY_INCLUDE,
    });

    if (!story || story.deletedAt) {
      throw new NotFoundException('Story not found');
    }

    if (story.expiresAt < new Date()) {
      throw new NotFoundException('Story has expired');
    }

    if (story.visibility === 'PRIVATE' && story.creatorId !== userId) {
      throw new NotFoundException('Story not found');
    }

    const [presented] = await this.presentStories([story], userId);
    return presented;
  }

  /**
   * Mark a story as viewed
   */
  async viewStory(userId: string, storyId: string) {
    const story = await this.getActiveStory(storyId);

    // Don't track views from the creator themselves
    if (story.creatorId === userId) {
      return { message: 'Story view tracked' };
    }

    await this.assertCanView(story, userId);

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
    const story = await this.getActiveStory(storyId);
    await this.assertCanView(story, userId);

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

    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException('Reply cannot be empty');
    }

    await this.assertCanView(story, userId);

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
      `[Réponse à votre story] ${trimmed}`,
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
   * Get viewers of a story (creator only), with whether each viewer liked it
   */
  async getStoryViewers(userId: string, storyId: string, page: number = 1, limit: number = 50) {
    // Verify story exists and belongs to user
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { creatorId: true, deletedAt: true },
    });

    if (!story || story.deletedAt) {
      throw new NotFoundException('Story not found');
    }

    if (story.creatorId !== userId) {
      throw new ForbiddenException('You can only view your own story viewers');
    }

    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;
    const skip = (safePage - 1) * safeLimit;

    const [views, total] = await Promise.all([
      this.prisma.storyView.findMany({
        where: { storyId },
        include: {
          viewer: {
            select: CREATOR_SELECT,
          },
        },
        orderBy: {
          viewedAt: 'desc',
        },
        skip,
        take: safeLimit,
      }),
      this.prisma.storyView.count({ where: { storyId } }),
    ]);

    const likes = views.length
      ? await this.prisma.storyLike.findMany({
          where: { storyId, userId: { in: views.map((view: any) => view.viewerId) } },
          select: { userId: true },
        })
      : [];
    const likerIds = new Set(likes.map((like: any) => like.userId));

    return {
      items: views.map((view: any) => ({ ...view, hasLiked: likerIds.has(view.viewerId) })),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Delete a story (creator only)
   */
  async deleteStory(userId: string, storyId: string) {
    // Verify story exists and belongs to user
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { creatorId: true, deletedAt: true },
    });

    if (!story || story.deletedAt) {
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
      select: { id: true, expiresAt: true, deletedAt: true, creatorId: true, visibility: true },
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
   * Stories uploaded through the media API are referenced by their storage key:
   * only keys from the creator's own folder are accepted.
   */
  private assertOwnMedia(userId: string, mediaRef?: string | null) {
    if (!mediaRef || /^https?:\/\//i.test(mediaRef)) return;

    if (!mediaRef.startsWith(`users/${userId}/`) || mediaRef.includes('..')) {
      throw new ForbiddenException('You can only publish your own media');
    }
  }

  /**
   * Ids (among creatorIds) of creators the viewer has an active subscription to
   */
  private async getSubscribedCreatorIds(viewerId: string, creatorIds: string[]) {
    if (creatorIds.length === 0) return new Set<string>();

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        subscriberId: viewerId,
        status: 'ACTIVE',
        currentPeriodEnd: { gte: new Date() },
        tier: { creatorId: { in: creatorIds } },
      },
      select: { tier: { select: { creatorId: true } } },
    });

    return new Set<string>(subscriptions.map((sub: any) => sub.tier.creatorId));
  }

  private canView(story: AccessCheckedStory, viewerId: string | undefined, subscribedIds: Set<string>) {
    if (viewerId && story.creatorId === viewerId) return true;
    if (story.visibility === 'PUBLIC') return true;
    if (story.visibility === 'PRIVATE') return false;
    return subscribedIds.has(story.creatorId);
  }

  private async assertCanView(story: AccessCheckedStory, viewerId: string) {
    const subscribedIds =
      story.creatorId === viewerId || story.visibility === 'PUBLIC'
        ? new Set<string>()
        : await this.getSubscribedCreatorIds(viewerId, [story.creatorId]);

    if (!this.canView(story, viewerId, subscribedIds)) {
      throw new ForbiddenException('This story is reserved for subscribers');
    }
  }

  private async signMedia(ref?: string | null) {
    if (!ref) return null;
    try {
      return await this.storageService.getSignedUrl(ref, 24 * 3600);
    } catch {
      return null;
    }
  }

  /**
   * Shape stories for a viewer: signed media URLs, like/view status, and
   * subscriber-only stories locked (media and text stripped) for non-subscribers.
   */
  private async presentStories<T extends AccessCheckedStory & Record<string, any>>(
    stories: T[],
    viewerId?: string,
    knownSubscribedIds?: Set<string>,
  ) {
    if (stories.length === 0) return [];

    const ids = stories.map((story) => story.id);
    const lockedCandidates = Array.from(
      new Set(
        stories
          .filter((story) => story.creatorId !== viewerId && story.visibility !== 'PUBLIC')
          .map((story) => story.creatorId),
      ),
    );

    const [subscribedIds, likes, views] = await Promise.all([
      knownSubscribedIds ??
        (viewerId ? this.getSubscribedCreatorIds(viewerId, lockedCandidates) : new Set<string>()),
      viewerId
        ? this.prisma.storyLike.findMany({
            where: { userId: viewerId, storyId: { in: ids } },
            select: { storyId: true },
          })
        : [],
      viewerId
        ? this.prisma.storyView.findMany({
            where: { viewerId, storyId: { in: ids } },
            select: { storyId: true },
          })
        : [],
    ]);

    const likedIds = new Set((likes as any[]).map((like) => like.storyId));
    const viewedIds = new Set((views as any[]).map((view) => view.storyId));

    return Promise.all(
      stories.map(async (story) => {
        const isOwn = !!viewerId && story.creatorId === viewerId;
        const base = {
          ...story,
          isOwn,
          isLiked: likedIds.has(story.id),
          // The creator has always "seen" their own stories
          isViewed: isOwn || viewedIds.has(story.id),
        };

        if (!this.canView(story, viewerId, subscribedIds)) {
          return {
            ...base,
            isLocked: true,
            mediaUrl: null,
            thumbnailUrl: null,
            text: null,
            caption: null,
          };
        }

        const [mediaUrl, thumbnailUrl] = await Promise.all([
          this.signMedia(story.mediaUrl),
          this.signMedia(story.thumbnailUrl),
        ]);

        return { ...base, isLocked: false, mediaUrl, thumbnailUrl };
      }),
    );
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
