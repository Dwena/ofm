import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';

// Define NotificationType type manually until Prisma client is regenerated
export type NotificationType =
  | 'NEW_SUBSCRIBER'
  | 'NEW_MESSAGE'
  | 'NEW_TIP'
  | 'NEW_COMMENT'
  | 'SUBSCRIPTION_RENEWAL'
  | 'PAYOUT_COMPLETED'
  | 'CONTENT_APPROVED'
  | 'CONTENT_REJECTED'
  | 'SYSTEM';
import {
  CreateCommentDto,
  UpdateCommentDto,
  GetCommentsDto,
  FollowCreatorDto,
  DiscoverCreatorsDto,
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
        type: 'COMMENT',
        title: 'Nouveau commentaire',
        message: `${comment.user.displayName || comment.user.username} a commenté votre contenu`,
        relatedId: contentId,
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
   * Follow a creator
   */
  async followCreator(userId: string, dto: FollowCreatorDto) {
    const { creatorId } = dto;

    // Can't follow yourself
    if (userId === creatorId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    // Check if creator exists
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
    });

    if (!creator || creator.role !== 'CREATOR') {
      throw new NotFoundException('Creator not found');
    }

    // Check if already following (using Report table as example, you'd want a Follow table)
    // For now, we'll use creatorProfile's follower count
    // In production, create a dedicated Follow table

    // Update follower count on creator profile
    await this.prisma.creatorProfile.update({
      where: { userId: creatorId },
      data: {
        totalSubscribers: {
          increment: 1,
        },
      },
    });

    // Create notification
    await this.createNotification({
      userId: creatorId,
      type: 'SUBSCRIPTION',
      title: 'Nouveau follower',
      message: `Quelqu'un vous suit maintenant`,
      relatedId: userId,
    });

    this.logger.log(`User ${userId} followed creator ${creatorId}`);

    return {
      success: true,
      message: 'Successfully followed creator',
      creatorId,
    };
  }

  /**
   * Unfollow a creator
   */
  async unfollowCreator(userId: string, creatorId: string) {
    // Check if creator exists
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
    });

    if (!creator || creator.role !== 'CREATOR') {
      throw new NotFoundException('Creator not found');
    }

    // Decrement follower count
    await this.prisma.creatorProfile.update({
      where: { userId: creatorId },
      data: {
        totalSubscribers: {
          decrement: 1,
        },
      },
    });

    this.logger.log(`User ${userId} unfollowed creator ${creatorId}`);

    return {
      success: true,
      message: 'Successfully unfollowed creator',
      creatorId,
    };
  }

  /**
   * Get following list
   */
  async getFollowing(userId: string) {
    // Get creators user has subscriptions with
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        subscriberId: userId,
        status: 'ACTIVE',
      },
      include: {
        tier: {
          include: {
            creator: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
                coverImage: true,
                creatorProfile: {
                  select: {
                    totalSubscribers: true,
                    totalContent: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      items: subscriptions
        .filter((sub: any) => sub.tier?.creator)
        .map((sub: any) => sub.tier.creator),
      total: subscriptions.length,
    };
  }

  /**
   * Discover creators
   */
  async discoverCreators(userId: string, dto: DiscoverCreatorsDto) {
    const { query, sortBy = 'POPULAR', page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const where: any = {
      role: 'CREATOR',
      status: 'ACTIVE',
      deletedAt: null,
    };

    // Search by username or display name
    if (query) {
      where.OR = [
        { username: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
      ];
    }

    // Build order by
    let orderBy: any = {};

    switch (sortBy) {
      case 'POPULAR':
        orderBy = {
          creatorProfile: {
            subscribersCount: 'desc',
          },
        };
        break;
      case 'NEW':
        orderBy = { createdAt: 'desc' };
        break;
      case 'RECOMMENDED':
        // For recommended, we could use ML or just popular for now
        orderBy = {
          creatorProfile: {
            subscribersCount: 'desc',
          },
        };
        break;
    }

    const [creators, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          displayName: true,
          bio: true,
          avatar: true,
          coverImage: true,
          createdAt: true,
          creatorProfile: {
            select: {
              totalSubscribers: true,
              totalContent: true,
              activeSubscriptionsCount: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Check if user is following each creator
    const userSubscriptions = await this.prisma.subscription.findMany({
      where: {
        subscriberId: userId,
        status: 'ACTIVE',
        tier: {
          creatorId: {
            in: creators.map((c: any) => c.id),
          },
        },
      },
      select: {
        tier: {
          select: {
            creatorId: true,
          },
        },
      },
    });

    const followingIds = new Set(userSubscriptions.map((s: any) => s.tier.creatorId));

    const creatorsWithFollowStatus = creators.map((creator: any) => ({
      ...creator,
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
   * Get notifications for user
   */
  async getNotifications(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({
        where: {
          userId,
          isRead: false,
        },
      }),
    ]);

    return {
      items: notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      unreadCount,
    };
  }

  /**
   * Mark notification as read
   */
  async markNotificationRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('Not your notification');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { message: 'All notifications marked as read' };
  }

  /**
   * Delete notification
   */
  async deleteNotification(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('Not your notification');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    return { message: 'Notification deleted' };
  }

  /**
   * Helper: Create notification
   */
  private async createNotification(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    relatedId?: string;
  }) {
    try {
      await this.prisma.notification.create({
        data: {
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message,
          relatedId: data.relatedId,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
    }
  }
}
