import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/database/prisma.service';
import { StripeService } from '../payments/stripe.service';
import { StorageService } from '../storage/storage.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { SearchContentDto, ContentSortBy } from './dto/search-content.dto';

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private storageService: StorageService,
    private configService: ConfigService,
  ) {}

  private readonly contentInclude = {
    creator: {
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
      },
    },
    files: {
      orderBy: { order: 'asc' as const },
    },
    _count: {
      select: {
        likes: true,
        comments: true,
      },
    },
  };

  async getCreatorContent(creatorId: string, userId?: string) {
    const items = await this.prisma.content.findMany({
      where: {
        creatorId,
        status: 'PUBLISHED',
        deletedAt: null,
        ...(creatorId !== userId && { visibility: { not: 'PRIVATE' } }),
      },
      include: this.contentInclude,
      orderBy: {
        publishedAt: 'desc',
      },
    });

    return this.withViewerAccess(items, userId);
  }

  /**
   * Global feed: published content from all creators. Media the viewer
   * is not entitled to is stripped and the item is flagged as locked.
   */
  async getFeed(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const items = await this.prisma.content.findMany({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        visibility: { not: 'PRIVATE' },
      },
      include: this.contentInclude,
      orderBy: {
        publishedAt: 'desc',
      },
      skip,
      take: limit,
    });

    return this.withViewerAccess(items, userId);
  }

  /**
   * Feed restricted to creators the user has an active subscription with
   */
  async getSubscriptionsFeed(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

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

    if (creatorIds.length === 0) {
      return [];
    }

    // Get content from subscribed creators
    const items = await this.prisma.content.findMany({
      where: {
        creatorId: {
          in: creatorIds,
        },
        status: 'PUBLISHED',
        deletedAt: null,
        visibility: { not: 'PRIVATE' },
      },
      include: this.contentInclude,
      orderBy: {
        publishedAt: 'desc',
      },
      skip,
      take: limit,
    });

    return this.withViewerAccess(items, userId);
  }

  async createContent(userId: string, dto: CreateContentDto) {
    // Verify user is a creator
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can create content');
    }

    // Validate PPV price
    if (dto.isPpv && (!dto.ppvPrice || dto.ppvPrice <= 0)) {
      throw new BadRequestException('PPV content must have a valid price');
    }

    // Create content
    const content = await this.prisma.content.create({
      data: {
        creatorId: userId,
        type: dto.type,
        visibility: dto.visibility || 'SUBSCRIBERS_ONLY',
        status: dto.scheduledFor ? 'DRAFT' : 'DRAFT',
        title: dto.title,
        description: dto.description,
        caption: dto.caption,
        isPpv: dto.isPpv || false,
        ppvPrice: dto.ppvPrice,
        scheduledFor: dto.scheduledFor,
      },
      include: {
        files: true,
      },
    });

    // Link uploaded files if provided
    if (dto.fileIds && dto.fileIds.length > 0) {
      await this.prisma.contentFile.updateMany({
        where: {
          id: { in: dto.fileIds },
        },
        data: {
          contentId: content.id,
        },
      });
    }

    this.logger.log(`Content created: ${content.id} by user ${userId}`);
    return content;
  }

  async updateContent(userId: string, contentId: string, dto: UpdateContentDto) {
    // Check ownership
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    if (content.creatorId !== userId) {
      throw new ForbiddenException('You can only update your own content');
    }

    // Update content
    const updated = await this.prisma.content.update({
      where: { id: contentId },
      data: {
        visibility: dto.visibility,
        title: dto.title,
        description: dto.description,
        caption: dto.caption,
        isPpv: dto.isPpv,
        ppvPrice: dto.ppvPrice,
        scheduledFor: dto.scheduledFor,
        updatedAt: new Date(),
      },
      include: this.contentInclude,
    });

    const [serialized] = await this.withViewerAccess([updated], userId);
    return serialized;
  }

  async publishContent(userId: string, contentId: string) {
    // Check ownership
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    if (content.creatorId !== userId) {
      throw new ForbiddenException('You can only publish your own content');
    }

    if (content.status === 'PUBLISHED') {
      throw new BadRequestException('Content is already published');
    }

    const published = await this.prisma.content.update({
      where: { id: contentId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      include: this.contentInclude,
    });

    const [serialized] = await this.withViewerAccess([published], userId);
    return serialized;
  }

  async deleteContent(userId: string, contentId: string) {
    // Check ownership
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    if (content.creatorId !== userId) {
      throw new ForbiddenException('You can only delete your own content');
    }

    // Soft delete
    await this.prisma.content.update({
      where: { id: contentId },
      data: {
        deletedAt: new Date(),
      },
    });

    this.logger.log(`Content deleted: ${contentId} by user ${userId}`);
    return { message: 'Content deleted successfully' };
  }

  async searchContent(userId: string, dto: SearchContentDto) {
    const { query, creatorId, type, visibility, isPpv, sortBy, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      status: 'PUBLISHED',
      deletedAt: null,
      visibility: { not: 'PRIVATE' },
    };

    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { caption: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (creatorId) {
      where.creatorId = creatorId;
    }

    if (type) {
      where.type = type;
    }

    if (visibility && visibility !== 'PRIVATE') {
      where.visibility = visibility;
    }

    if (isPpv !== undefined) {
      where.isPpv = isPpv;
    }

    // Build order by
    let orderBy: any = { publishedAt: 'desc' };

    switch (sortBy) {
      case ContentSortBy.POPULAR:
        orderBy = { likeCount: 'desc' };
        break;
      case ContentSortBy.VIEWS:
        orderBy = { viewCount: 'desc' };
        break;
      case ContentSortBy.LIKES:
        orderBy = { likeCount: 'desc' };
        break;
      default:
        orderBy = { publishedAt: 'desc' };
    }

    const [items, total] = await Promise.all([
      this.prisma.content.findMany({
        where,
        include: this.contentInclude,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.content.count({ where }),
    ]);

    return {
      items: await this.withViewerAccess(items, userId),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getContentById(contentId: string, userId?: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      include: this.contentInclude,
    });

    if (!content || content.deletedAt) {
      throw new NotFoundException('Content not found');
    }

    // Drafts and private content are only visible to their creator
    const isOwner = content.creatorId === userId;
    if (!isOwner && (content.status !== 'PUBLISHED' || content.visibility === 'PRIVATE')) {
      throw new NotFoundException('Content not found');
    }

    // Increment view count
    await this.prisma.content.update({
      where: { id: contentId },
      data: { viewCount: { increment: 1 } },
    });

    const [serialized] = await this.withViewerAccess([content], userId);
    return serialized;
  }

  // Moderation methods
  async moderateContent(adminId: string, contentId: string, approved: boolean, notes?: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    return this.prisma.content.update({
      where: { id: contentId },
      data: {
        isModerated: true,
        moderatedAt: new Date(),
        moderatedBy: adminId,
        moderationNotes: notes,
        status: approved ? 'PUBLISHED' : 'REJECTED',
        publishedAt: approved ? new Date() : null,
      },
    });
  }

  async getContentForModeration(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.content.findMany({
        where: {
          isModerated: false,
          status: 'UNDER_REVIEW',
          deletedAt: null,
        },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
          files: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
        skip,
        take: limit,
      }),
      this.prisma.content.count({
        where: {
          isModerated: false,
          status: 'UNDER_REVIEW',
          deletedAt: null,
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Likes methods
  async toggleLike(userId: string, contentId: string) {
    // Verify content exists
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true, deletedAt: true, status: true },
    });

    if (!content || content.deletedAt) {
      throw new NotFoundException('Content not found');
    }

    if (content.status !== 'PUBLISHED') {
      throw new BadRequestException('Cannot like unpublished content');
    }

    // Check if already liked
    const existingLike = await this.prisma.contentLike.findUnique({
      where: {
        contentId_userId: {
          contentId,
          userId,
        },
      },
    });

    if (existingLike) {
      // Unlike - delete the like and decrement count
      await this.prisma.$transaction([
        this.prisma.contentLike.delete({
          where: { id: existingLike.id },
        }),
        this.prisma.content.update({
          where: { id: contentId },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);

      this.logger.log(`Content unliked: ${contentId} by user ${userId}`);
      return { liked: false, message: 'Content unliked' };
    } else {
      // Like - create the like and increment count
      await this.prisma.$transaction([
        this.prisma.contentLike.create({
          data: {
            contentId,
            userId,
          },
        }),
        this.prisma.content.update({
          where: { id: contentId },
          data: { likeCount: { increment: 1 } },
        }),
      ]);

      this.logger.log(`Content liked: ${contentId} by user ${userId}`);
      return { liked: true, message: 'Content liked' };
    }
  }

  async getLikes(contentId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    // Verify content exists
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true, deletedAt: true },
    });

    if (!content || content.deletedAt) {
      throw new NotFoundException('Content not found');
    }

    const [items, total] = await Promise.all([
      this.prisma.contentLike.findMany({
        where: { contentId },
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
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.contentLike.count({ where: { contentId } }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async hasUserLiked(userId: string, contentId: string): Promise<boolean> {
    const like = await this.prisma.contentLike.findUnique({
      where: {
        contentId_userId: {
          contentId,
          userId,
        },
      },
    });

    return !!like;
  }

  // PPV methods
  async unlockContent(userId: string, contentId: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            stripeAccountId: true,
            stripeOnboarded: true,
          },
        },
      },
    });

    if (!content || content.deletedAt || content.status !== 'PUBLISHED') {
      throw new NotFoundException('Content not found');
    }

    if (!content.isPpv || !content.ppvPrice || Number(content.ppvPrice) <= 0) {
      throw new BadRequestException('This content is not pay-per-view');
    }

    if (content.creatorId === userId) {
      throw new BadRequestException('You cannot unlock your own content');
    }

    // Already unlocked: nothing to charge
    const existingUnlock = await this.prisma.contentUnlock.findUnique({
      where: {
        contentId_userId: {
          contentId,
          userId,
        },
      },
    });

    if (existingUnlock) {
      return { unlocked: true, alreadyUnlocked: true, contentId };
    }

    if (!content.creator.stripeAccountId || !content.creator.stripeOnboarded) {
      throw new BadRequestException('Creator payment account is not ready');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Create or get Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripeService.createCustomer(user.email, user.username);
      customerId = customer.id;

      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    const amount = Number(content.ppvPrice);

    // Calculate platform fee (15% default)
    const platformFeePercentage = parseFloat(
      this.configService.get('STRIPE_PLATFORM_FEE_PERCENTAGE', '15'),
    );
    const platformFee = (amount * platformFeePercentage) / 100;
    const netAmount = amount - platformFee;

    // Create Stripe payment intent on the creator's connected account
    const paymentIntent = await this.stripeService.createPaymentIntent(
      amount,
      'EUR',
      customerId,
      content.creator.stripeAccountId,
    );

    // Record the transaction, grant access and credit the creator atomically
    const [transaction] = await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          fromUserId: userId,
          toUserId: content.creatorId,
          type: 'PPV_UNLOCK',
          status: 'COMPLETED',
          amount,
          currency: 'EUR',
          platformFee,
          netAmount,
          stripePaymentIntentId: paymentIntent.id,
          contentId,
          metadata: {
            type: 'ppv_unlock',
          },
        },
      }),
      this.prisma.contentUnlock.create({
        data: {
          contentId,
          userId,
          paidAmount: amount,
        },
      }),
      this.prisma.creatorProfile.updateMany({
        where: { userId: content.creatorId },
        data: {
          totalEarnings: {
            increment: netAmount,
          },
        },
      }),
    ]);

    // Notify creator
    await this.prisma.notification.create({
      data: {
        userId: content.creatorId,
        type: 'SYSTEM',
        title: 'Contenu débloqué',
        message: `${user.displayName || user.username} a débloqué votre contenu pour ${amount.toFixed(2)}€`,
        linkUrl: `/content/${contentId}`,
        metadata: {
          fromUserId: userId,
          contentId,
          amount,
          transactionId: transaction.id,
        },
      },
    });

    this.logger.log(`Content unlocked: ${contentId} by user ${userId} for €${amount}`);

    return {
      unlocked: true,
      alreadyUnlocked: false,
      contentId,
      transactionId: transaction.id,
      paymentIntentClientSecret: paymentIntent.client_secret,
    };
  }

  /**
   * Attach the viewer's access state (locked, unlocked, liked) to content
   * and strip media the viewer is not entitled to see.
   */
  private async withViewerAccess(items: any[], viewerId?: string) {
    if (items.length === 0) {
      return [];
    }

    const contentIds = items.map((item) => item.id);
    const creatorIds = [...new Set(items.map((item) => item.creatorId))];

    const [subscriptions, unlocks, likes] = viewerId
      ? await Promise.all([
          this.prisma.subscription.findMany({
            where: {
              subscriberId: viewerId,
              status: 'ACTIVE',
              currentPeriodEnd: { gte: new Date() },
              tier: { creatorId: { in: creatorIds } },
            },
            select: { tier: { select: { creatorId: true } } },
          }),
          this.prisma.contentUnlock.findMany({
            where: { userId: viewerId, contentId: { in: contentIds } },
            select: { contentId: true },
          }),
          this.prisma.contentLike.findMany({
            where: { userId: viewerId, contentId: { in: contentIds } },
            select: { contentId: true },
          }),
        ])
      : [[], [], []];

    const subscribedCreatorIds = new Set(subscriptions.map((sub: any) => sub.tier.creatorId));
    const unlockedIds = new Set(unlocks.map((unlock: any) => unlock.contentId));
    const likedIds = new Set(likes.map((like: any) => like.contentId));

    return Promise.all(
      items.map((item) =>
        this.serializeContent(item, {
          isOwner: !!viewerId && item.creatorId === viewerId,
          isSubscribed: subscribedCreatorIds.has(item.creatorId),
          hasUnlocked: unlockedIds.has(item.id),
          isLiked: likedIds.has(item.id),
        }),
      ),
    );
  }

  private async serializeContent(
    content: any,
    access: { isOwner: boolean; isSubscribed: boolean; hasUnlocked: boolean; isLiked: boolean },
  ) {
    const { files = [], ...rest } = content;

    let canAccess: boolean;
    if (access.isOwner) {
      canAccess = true;
    } else if (content.visibility === 'PRIVATE') {
      canAccess = false;
    } else if (content.isPpv) {
      // PPV media requires a purchase, even for subscribers
      canAccess = access.hasUnlocked;
    } else {
      canAccess = content.visibility === 'PUBLIC' || access.isSubscribed;
    }

    return {
      ...rest,
      ppvPrice: content.ppvPrice != null ? Number(content.ppvPrice) : null,
      files: canAccess ? await Promise.all(files.map((file: any) => this.serializeFile(file))) : [],
      mediaCount: files.length,
      isLocked: !canAccess,
      hasUnlocked: access.hasUnlocked,
      isLiked: access.isLiked,
      isSubscribed: access.isSubscribed,
    };
  }

  private async serializeFile(file: any) {
    const { storagePath, thumbnailPath, size, ...rest } = file;

    const [url, thumbnailUrl] = await Promise.all([
      this.storageService.getSignedUrl(storagePath, 3600),
      thumbnailPath ? this.storageService.getSignedUrl(thumbnailPath, 3600) : null,
    ]);

    let type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' = 'FILE';
    if (file.mimeType?.startsWith('image/')) type = 'IMAGE';
    else if (file.mimeType?.startsWith('video/')) type = 'VIDEO';
    else if (file.mimeType?.startsWith('audio/')) type = 'AUDIO';

    return {
      ...rest,
      type,
      size: Number(size),
      url,
      thumbnailUrl,
    };
  }
}
