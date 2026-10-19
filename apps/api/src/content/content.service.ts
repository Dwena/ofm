import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/database/prisma.service';
import { OneTimePaymentService } from '../payments/one-time-payment.service';
import { StorageService } from '../storage/storage.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { SearchContentDto, ContentSortBy } from './dto/search-content.dto';
import { MyContentQueryDto, MyContentStatusFilter } from './dto/my-content.dto';

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private prisma: PrismaService,
    private oneTimePayments: OneTimePaymentService,
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
        // Soft-deleted comments must not be counted
        comments: { where: { deletedAt: null } },
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

    const visibility = dto.visibility || 'SUBSCRIBERS_ONLY';
    const isPpv = !!dto.isPpv || visibility === 'PPV';

    // Validate PPV price
    if (isPpv && (!dto.ppvPrice || dto.ppvPrice <= 0)) {
      throw new BadRequestException('PPV content must have a valid price');
    }

    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (scheduledFor) {
      this.assertFutureDate(scheduledFor);
    }

    // Scheduled content stays a draft until its date; otherwise publish when asked
    const publishNow = !!dto.publish && !scheduledFor;

    // Create content
    const content = await this.prisma.content.create({
      data: {
        creatorId: userId,
        type: dto.type,
        visibility,
        status: publishNow ? 'PUBLISHED' : 'DRAFT',
        publishedAt: publishNow ? new Date() : null,
        title: dto.title,
        description: dto.description,
        caption: dto.caption,
        isPpv,
        ppvPrice: isPpv ? dto.ppvPrice : null,
        scheduledFor,
      },
      include: {
        files: true,
      },
    });

    // Link uploaded files: only the creator's own files not attached to other content
    if (dto.fileIds && dto.fileIds.length > 0) {
      await Promise.all(
        dto.fileIds.map((fileId, order) =>
          this.prisma.contentFile.updateMany({
            where: {
              id: fileId,
              contentId: null,
              storagePath: { startsWith: `users/${userId}/` },
            },
            data: {
              contentId: content.id,
              order,
            },
          }),
        ),
      );
    }

    if (publishNow) {
      await this.refreshCreatorContentCount(userId);
    }

    this.logger.log(`Content created: ${content.id} by user ${userId}`);
    return content;
  }

  /**
   * Content of the authenticated creator, every status included, with
   * per-content stats (views, likes, comments, unlocks, PPV revenue) and the
   * number of items per status for the filters.
   */
  async getMyContent(userId: string, query: MyContentQueryDto = {}) {
    const { status = MyContentStatusFilter.ALL, search, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = { creatorId: userId, deletedAt: null };

    switch (status) {
      case MyContentStatusFilter.PUBLISHED:
        where.status = 'PUBLISHED';
        break;
      case MyContentStatusFilter.DRAFT:
        where.status = 'DRAFT';
        where.scheduledFor = null;
        break;
      case MyContentStatusFilter.SCHEDULED:
        where.status = 'DRAFT';
        where.scheduledFor = { not: null };
        break;
      case MyContentStatusFilter.ARCHIVED:
        where.status = 'ARCHIVED';
        break;
      case MyContentStatusFilter.REVIEW:
        where.status = { in: ['UNDER_REVIEW', 'REJECTED'] };
        break;
    }

    if (search?.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: 'insensitive' } },
        { description: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [items, total, allStatuses] = await Promise.all([
      this.prisma.content.findMany({
        where,
        include: {
          creator: this.contentInclude.creator,
          files: this.contentInclude.files,
          _count: {
            select: {
              likes: true,
              comments: { where: { deletedAt: null } },
              unlocks: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.content.count({ where }),
      this.prisma.content.findMany({
        where: { creatorId: userId, deletedAt: null },
        select: { status: true, scheduledFor: true },
      }),
    ]);

    const counts = { ALL: allStatuses.length, PUBLISHED: 0, DRAFT: 0, SCHEDULED: 0, ARCHIVED: 0, REVIEW: 0 };
    for (const item of allStatuses) {
      if (item.status === 'PUBLISHED') counts.PUBLISHED++;
      else if (item.status === 'ARCHIVED') counts.ARCHIVED++;
      else if (item.status === 'DRAFT') {
        if (item.scheduledFor) counts.SCHEDULED++;
        else counts.DRAFT++;
      } else counts.REVIEW++;
    }

    // Creator's net revenue per content (PPV unlocks)
    const ids = items.map((item: any) => item.id);
    const revenues: any[] = ids.length
      ? await (this.prisma.transaction as any).groupBy({
          by: ['contentId'],
          where: { toUserId: userId, contentId: { in: ids }, status: 'COMPLETED' },
          _sum: { netAmount: true },
        })
      : [];
    const revenueByContent = new Map<string, number>(
      revenues.map((row: any) => [row.contentId, Number(row._sum?.netAmount ?? 0)]),
    );

    const serialized = await this.withViewerAccess(items, userId);

    return {
      items: serialized.map((item: any) => ({
        ...item,
        stats: {
          views: item.viewCount ?? 0,
          likes: item._count?.likes ?? 0,
          comments: item._count?.comments ?? 0,
          unlocks: item._count?.unlocks ?? 0,
          revenue: revenueByContent.get(item.id) ?? 0,
        },
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      counts,
    };
  }

  async updateContent(userId: string, contentId: string, dto: UpdateContentDto) {
    const content = await this.findOwnContent(userId, contentId, 'update');

    // PPV follows the visibility unless given explicitly
    const visibility = dto.visibility ?? content.visibility;
    let isPpv = dto.isPpv ?? (dto.visibility !== undefined ? visibility === 'PPV' : content.isPpv);
    if (visibility === 'PPV') {
      isPpv = true;
    }
    const ppvPrice =
      dto.ppvPrice !== undefined ? dto.ppvPrice : content.ppvPrice != null ? Number(content.ppvPrice) : null;

    if (isPpv && (!ppvPrice || ppvPrice <= 0)) {
      throw new BadRequestException('PPV content must have a valid price');
    }

    let scheduledFor: Date | null | undefined = undefined;
    if (dto.scheduledFor !== undefined) {
      if (dto.scheduledFor !== null) {
        if (content.status !== 'DRAFT') {
          throw new BadRequestException('Only drafts can be scheduled');
        }
        scheduledFor = new Date(dto.scheduledFor);
        this.assertFutureDate(scheduledFor);
      } else {
        scheduledFor = null;
      }
    }

    // Update content
    const updated = await this.prisma.content.update({
      where: { id: contentId },
      data: {
        visibility: dto.visibility,
        title: dto.title,
        description: dto.description,
        caption: dto.caption,
        isPpv,
        ppvPrice: isPpv ? ppvPrice : null,
        scheduledFor,
        updatedAt: new Date(),
      },
      include: this.contentInclude,
    });

    const [serialized] = await this.withViewerAccess([updated], userId);
    return serialized;
  }

  async publishContent(userId: string, contentId: string) {
    const content = await this.findOwnContent(userId, contentId, 'publish');

    if (content.status === 'PUBLISHED') {
      throw new BadRequestException('Content is already published');
    }

    if (content.status === 'ARCHIVED') {
      throw new BadRequestException('Archived content must be unarchived');
    }

    // Under review / rejected content cannot bypass moderation
    if (content.status !== 'DRAFT') {
      throw new BadRequestException('Content under moderation cannot be published');
    }

    const published = await this.prisma.content.update({
      where: { id: contentId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        scheduledFor: null,
      },
      include: this.contentInclude,
    });

    await this.refreshCreatorContentCount(userId);

    const [serialized] = await this.withViewerAccess([published], userId);
    return serialized;
  }

  /**
   * Hide published content from fans without deleting it
   */
  async archiveContent(userId: string, contentId: string) {
    const content = await this.findOwnContent(userId, contentId, 'archive');

    if (content.status !== 'PUBLISHED') {
      throw new BadRequestException('Only published content can be archived');
    }

    const archived = await this.prisma.content.update({
      where: { id: contentId },
      data: { status: 'ARCHIVED' },
      include: this.contentInclude,
    });

    await this.refreshCreatorContentCount(userId);

    const [serialized] = await this.withViewerAccess([archived], userId);
    return serialized;
  }

  /**
   * Make archived content visible again (keeps its original publication date)
   */
  async unarchiveContent(userId: string, contentId: string) {
    const content = await this.findOwnContent(userId, contentId, 'unarchive');

    if (content.status !== 'ARCHIVED') {
      throw new BadRequestException('Content is not archived');
    }

    const restored = await this.prisma.content.update({
      where: { id: contentId },
      data: {
        status: 'PUBLISHED',
        publishedAt: content.publishedAt ?? new Date(),
      },
      include: this.contentInclude,
    });

    await this.refreshCreatorContentCount(userId);

    const [serialized] = await this.withViewerAccess([restored], userId);
    return serialized;
  }

  async deleteContent(userId: string, contentId: string) {
    await this.findOwnContent(userId, contentId, 'delete');

    // Soft delete
    await this.prisma.content.update({
      where: { id: contentId },
      data: {
        deletedAt: new Date(),
      },
    });

    await this.refreshCreatorContentCount(userId);

    this.logger.log(`Content deleted: ${contentId} by user ${userId}`);
    return { message: 'Content deleted successfully' };
  }

  /**
   * Publish scheduled drafts whose publication date has passed
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async publishScheduledContent() {
    const due = await this.prisma.content.findMany({
      where: {
        status: 'DRAFT',
        deletedAt: null,
        scheduledFor: { lte: new Date() },
      },
      select: { id: true, creatorId: true },
    });

    if (due.length === 0) {
      return 0;
    }

    await this.prisma.content.updateMany({
      where: { id: { in: due.map((item: any) => item.id) }, status: 'DRAFT' },
      data: { status: 'PUBLISHED', publishedAt: new Date(), scheduledFor: null },
    });

    const creatorIds: string[] = [...new Set<string>(due.map((item: any) => item.creatorId))];
    await Promise.all(creatorIds.map((creatorId) => this.refreshCreatorContentCount(creatorId)));

    this.logger.log(`Published ${due.length} scheduled content item(s)`);
    return due.length;
  }

  private async findOwnContent(userId: string, contentId: string, action: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content || content.deletedAt) {
      throw new NotFoundException('Content not found');
    }

    if (content.creatorId !== userId) {
      throw new ForbiddenException(`You can only ${action} your own content`);
    }

    return content;
  }

  private assertFutureDate(date: Date) {
    if (isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      throw new BadRequestException('The scheduled date must be in the future');
    }
  }

  /**
   * Keep the creator profile's published content counter in sync
   */
  private async refreshCreatorContentCount(creatorId: string) {
    const totalContent = await this.prisma.content.count({
      where: { creatorId, status: 'PUBLISHED', deletedAt: null },
    });

    await this.prisma.creatorProfile.updateMany({
      where: { userId: creatorId },
      data: { totalContent },
    });
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

    // Count views from other users only
    if (!isOwner) {
      await this.prisma.content.update({
        where: { id: contentId },
        data: { viewCount: { increment: 1 } },
      });
    }

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

  /**
   * Start a PPV purchase. Access is granted only once the payment succeeds:
   * through the Stripe webhook or confirmUnlock(), whichever comes first.
   */
  async unlockContent(userId: string, contentId: string, paymentMethodId?: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
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

    const payment = await this.oneTimePayments.startPayment({
      payerId: userId,
      creatorId: content.creatorId,
      kind: 'content_unlock',
      amount: Number(content.ppvPrice),
      contentId,
      paymentMethodId,
      description: `Contenu PPV de @${content.creator.username}`,
    });

    this.logger.log(`PPV unlock started: ${contentId} by user ${userId} (${payment.status})`);

    return {
      ...payment,
      unlocked: payment.completed,
      alreadyUnlocked: false,
      contentId,
    };
  }

  /**
   * Re-check a PPV payment with Stripe after client-side confirmation (idempotent)
   */
  async confirmUnlock(userId: string, contentId: string, paymentIntentId: string) {
    const payment = await this.oneTimePayments.confirmPayment(userId, paymentIntentId, {
      kind: 'content_unlock',
      contentId,
    });

    return {
      ...payment,
      unlocked: payment.completed,
      contentId,
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
