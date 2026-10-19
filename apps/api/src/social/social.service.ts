import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';

import {
  CreateCommentDto,
  UpdateCommentDto,
  GetCommentsDto,
  FollowCreatorDto,
  DiscoverCreatorsDto,
  SearchCreatorsDto,
} from './dto/social.dto';

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a comment
   */
  async createComment(userId: string, dto: CreateCommentDto) {
    const { contentId, text } = dto;

    // Check if content exists
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content || content.deletedAt) {
      throw new NotFoundException('Content not found');
    }

    // Drafts and private content can only be commented by their creator
    const isOwner = content.creatorId === userId;
    if (!isOwner && (content.status !== 'PUBLISHED' || content.visibility === 'PRIVATE')) {
      throw new NotFoundException('Content not found');
    }

    // Create comment
    const comment = await this.prisma.comment.create({
      data: {
        userId,
        contentId,
        text,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    // Increment comment count on content
    await this.prisma.content.update({
      where: { id: contentId },
      data: {
        commentCount: {
          increment: 1,
        },
      },
    });

    // Create notification for content creator (if not self-comment)
    if (content.creatorId !== userId) {
      await this.createNotification({
        userId: content.creatorId,
        type: NotificationType.NEW_COMMENT,
        title: 'Nouveau commentaire',
        message: `${comment.user.displayName || comment.user.username} a commenté votre contenu`,
        linkUrl: `/content/${contentId}`,
      });
    }

    this.logger.log(`Comment created: ${comment.id} on content ${contentId}`);

    return comment;
  }

  /**
   * Get comments for content
   */
  async getComments(dto: GetCommentsDto) {
    const { contentId, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: {
          contentId,
          deletedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
      }),
      this.prisma.comment.count({
        where: {
          contentId,
          deletedAt: null,
        },
      }),
    ]);

    return {
      items: comments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update a comment
   */
  async updateComment(userId: string, commentId: string, dto: UpdateCommentDto) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException('You can only update your own comments');
    }

    return this.prisma.comment.update({
      where: { id: commentId },
      data: {
        text: dto.text,
        updatedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });
  }

  /**
   * Delete a comment
   */
  async deleteComment(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        content: true,
      },
    });

    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }

    // Allow deletion by comment owner or content creator
    if (comment.userId !== userId && comment.content.creatorId !== userId) {
      throw new ForbiddenException('You can only delete your own comments or comments on your content');
    }

    // Soft delete
    await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        deletedAt: new Date(),
      },
    });

    // Decrement comment count
    await this.prisma.content.update({
      where: { id: comment.contentId },
      data: {
        commentCount: {
          decrement: 1,
        },
      },
    });

    this.logger.log(`Comment deleted: ${commentId}`);

    return { message: 'Comment deleted successfully' };
  }

  /**
   * Follow a creator (free). Idempotent: following twice keeps a single row.
   * Following never changes CreatorProfile.totalSubscribers, which only counts
   * paid subscriptions (see SubscriptionSyncService).
   */
  async followCreator(userId: string, dto: FollowCreatorDto) {
    const { creatorId } = dto;

    // Can't follow yourself
    if (userId === creatorId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    await this.findCreatorOrFail(creatorId);

    const existing = await this.prisma.follow.findUnique({
      where: { followerId_creatorId: { followerId: userId, creatorId } },
    });

    let created = false;
    if (!existing) {
      try {
        await this.prisma.follow.create({
          data: { followerId: userId, creatorId },
        });
        created = true;
      } catch (error: any) {
        // Concurrent follow: the unique constraint already holds the row
        if (error?.code !== 'P2002') {
          throw error;
        }
      }
    }

    if (created) {
      const follower = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true },
      });

      await this.createNotification({
        userId: creatorId,
        type: NotificationType.NEW_FOLLOWER,
        title: 'Nouveau follower',
        message: `${follower?.displayName || follower?.username || "Quelqu'un"} vous suit maintenant`,
        linkUrl: follower?.username ? `/${follower.username}` : undefined,
        metadata: { kind: 'NEW_FOLLOWER', followerId: userId },
      });

      this.logger.log(`User ${userId} followed creator ${creatorId}`);
    }

    const followersCount = await this.countFollowers(creatorId);

    return {
      success: true,
      message: 'Successfully followed creator',
      creatorId,
      isFollowing: true,
      followersCount,
    };
  }

  /**
   * Unfollow a creator. Idempotent: unfollowing a creator you don't follow is a no-op.
   */
  async unfollowCreator(userId: string, creatorId: string) {
    await this.findCreatorOrFail(creatorId);

    const { count } = await this.prisma.follow.deleteMany({
      where: { followerId: userId, creatorId },
    });

    if (count > 0) {
      this.logger.log(`User ${userId} unfollowed creator ${creatorId}`);
    }

    const followersCount = await this.countFollowers(creatorId);

    return {
      success: true,
      message: 'Successfully unfollowed creator',
      creatorId,
      isFollowing: false,
      followersCount,
    };
  }

  /**
   * Follow status of the current user for a creator
   */
  async getFollowStatus(userId: string, creatorId: string) {
    const [follow, followersCount] = await Promise.all([
      this.prisma.follow.findUnique({
        where: { followerId_creatorId: { followerId: userId, creatorId } },
        select: { createdAt: true },
      }),
      this.countFollowers(creatorId),
    ]);

    return {
      creatorId,
      isFollowing: !!follow,
      followedAt: follow?.createdAt ?? null,
      followersCount,
    };
  }

  /**
   * Creators followed by the user (most recent first)
   */
  async getFollowing(userId: string) {
    const follows = await this.prisma.follow.findMany({
      where: {
        followerId: userId,
        creator: { deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            coverImage: true,
            bio: true,
            creatorProfile: {
              select: {
                totalSubscribers: true,
                totalContent: true,
              },
            },
            _count: {
              select: { followers: true },
            },
          },
        },
      },
    });

    const creatorIds = follows.map((f: any) => f.creatorId);
    const subscriptions = creatorIds.length
      ? await this.prisma.subscription.findMany({
          where: {
            subscriberId: userId,
            status: 'ACTIVE',
            tier: { creatorId: { in: creatorIds } },
          },
          select: { tier: { select: { creatorId: true } } },
        })
      : [];
    const subscribedIds = new Set(subscriptions.map((s: any) => s.tier.creatorId));

    const items = follows
      .filter((f: any) => f.creator)
      .map((f: any) => {
        const { _count, ...creator } = f.creator;
        return {
          ...creator,
          followersCount: _count?.followers ?? 0,
          followedAt: f.createdAt,
          isFollowing: true,
          isSubscribed: subscribedIds.has(creator.id),
        };
      });

    return {
      items,
      total: items.length,
    };
  }

  private async findCreatorOrFail(creatorId: string) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { id: true, role: true, deletedAt: true },
    });

    if (!creator || creator.role !== 'CREATOR' || creator.deletedAt) {
      throw new NotFoundException('Creator not found');
    }

    return creator;
  }

  private countFollowers(creatorId: string) {
    return this.prisma.follow.count({ where: { creatorId } });
  }

  /**
   * Discover creators
   *
   * - POPULAR / RECOMMENDED: most subscribers first; NEW: most recent accounts first.
   * - PRICE_ASC / PRICE_DESC and minPrice / maxPrice work on the creator's
   *   cheapest active tier (the "from" price shown on cards). Prisma cannot
   *   order by a relation aggregate, so those cases rank the matching ids in
   *   memory, then load the requested page.
   * - The requesting user is never listed.
   */
  async discoverCreators(userId: string, dto: DiscoverCreatorsDto) {
    const { query, sortBy = 'POPULAR', page = 1, limit = 20, minPrice, maxPrice } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      role: 'CREATOR',
      status: 'ACTIVE',
      deletedAt: null,
      ...(userId ? { id: { not: userId } } : {}),
    };

    // Search by username or display name
    const search = query?.trim();
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const cheapestTier = {
      where: { isActive: true },
      select: { price: true },
      orderBy: { price: 'asc' as const },
      take: 1,
    };

    const select = {
      id: true,
      username: true,
      displayName: true,
      bio: true,
      avatar: true,
      coverImage: true,
      location: true,
      kycStatus: true,
      createdAt: true,
      creatorProfile: {
        select: {
          totalSubscribers: true,
          totalContent: true,
        },
      },
      subscriptionTiers: cheapestTier,
    };

    const byPrice = sortBy === 'PRICE_ASC' || sortBy === 'PRICE_DESC';
    const priceFiltered = minPrice !== undefined || maxPrice !== undefined;

    let creators: any[];
    let total: number;

    if (byPrice || priceFiltered) {
      const candidates = await this.prisma.user.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          creatorProfile: { select: { totalSubscribers: true } },
          subscriptionTiers: cheapestTier,
        },
      });

      const ranked = candidates
        .map((c: any) => ({
          id: c.id as string,
          price: c.subscriptionTiers?.[0] ? Number(c.subscriptionTiers[0].price) : null,
          subscribers: c.creatorProfile?.totalSubscribers ?? 0,
          createdAt: new Date(c.createdAt).getTime(),
        }))
        .filter((c) => {
          if (!priceFiltered) return true;
          // A creator without an active tier cannot be subscribed to
          if (c.price === null) return false;
          if (minPrice !== undefined && c.price < minPrice) return false;
          if (maxPrice !== undefined && c.price > maxPrice) return false;
          return true;
        })
        .sort((a, b) => {
          if (byPrice && a.price !== b.price) {
            // Creators without a tier always come last
            if (a.price === null) return 1;
            if (b.price === null) return -1;
            return sortBy === 'PRICE_ASC' ? a.price - b.price : b.price - a.price;
          }
          if (sortBy === 'NEW') return b.createdAt - a.createdAt;
          return b.subscribers - a.subscribers;
        });

      total = ranked.length;
      const pageIds = ranked.slice(skip, skip + limit).map((c) => c.id);
      const rows: any[] = pageIds.length
        ? await this.prisma.user.findMany({ where: { id: { in: pageIds } }, select })
        : [];
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      creators = pageIds.map((id) => rowsById.get(id)).filter(Boolean);
    } else {
      const orderBy: Prisma.UserOrderByWithRelationInput[] =
        sortBy === 'NEW'
          ? [{ createdAt: 'desc' }]
          : [{ creatorProfile: { totalSubscribers: 'desc' } }, { createdAt: 'desc' }];

      [creators, total] = await Promise.all([
        this.prisma.user.findMany({ where, orderBy, skip, take: limit, select }),
        this.prisma.user.count({ where }),
      ]);
    }

    const creatorIds = creators.map((c: any) => c.id);

    // Check if the user is subscribed to / following each creator
    const [userSubscriptions, userFollows] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          subscriberId: userId,
          status: 'ACTIVE',
          tier: { creatorId: { in: creatorIds } },
        },
        select: { tier: { select: { creatorId: true } } },
      }),
      this.prisma.follow.findMany({
        where: { followerId: userId, creatorId: { in: creatorIds } },
        select: { creatorId: true },
      }),
    ]);

    const subscribedIds = new Set(userSubscriptions.map((s: any) => s.tier.creatorId));
    const followingIds = new Set(userFollows.map((f: any) => f.creatorId));

    const creatorsWithFollowStatus = creators.map(({ subscriptionTiers, ...creator }: any) => ({
      ...creator,
      // Cheapest active tier, so the discover page can display/filter by price
      subscriptionPrice: subscriptionTiers?.[0] ? Number(subscriptionTiers[0].price) : null,
      isSubscribed: subscribedIds.has(creator.id),
      isFollowing: followingIds.has(creator.id),
    }));

    return {
      items: creatorsWithFollowStatus,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Search creators by username or display name
   */
  async searchCreators(dto: SearchCreatorsDto) {
    const { q, limit = 10 } = dto;
    const query = q.trim();

    if (!query) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        role: 'CREATOR',
        status: 'ACTIVE',
        deletedAt: null,
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: {
        creatorProfile: {
          totalSubscribers: 'desc',
        },
      },
      take: limit,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        role: true,
        creatorProfile: {
          select: {
            totalSubscribers: true,
            totalContent: true,
          },
        },
      },
    });
  }

  /**
   * Helper: Create notification
   */
  private async createNotification(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    linkUrl?: string;
    metadata?: Prisma.InputJsonObject;
  }) {
    try {
      await this.prisma.notification.create({
        data: {
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message,
          linkUrl: data.linkUrl,
          metadata: data.metadata,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
    }
  }
}
