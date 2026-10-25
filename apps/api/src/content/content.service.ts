import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/database/prisma.service';
import { PaymentFlowService, PurchaseOptions } from '../payments/payment-flow.service';
import { StorageService } from '../storage/storage.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { SearchContentDto, ContentSortBy } from './dto/search-content.dto';
import { MyContentQueryDto, MyContentStatusFilter } from './dto/my-content.dto';
import {
  PUBLISHING_USER_SELECT,
  assertCanPublish,
  isContentPremoderationEnabled,
  resolveContentCoPerformers,
} from '../verification/publication-gate';
import { assertTextAllowed, checkText, reviewNote } from '../moderation/content-rules';
import { isMediaScanConfigured } from '../media/media-scan/media-scan.service';

/** Signed URLs of the media shown to moderators */
const REVIEW_URL_TTL_SECONDS = 900;

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private prisma: PrismaService,
    private paymentFlow: PaymentFlowService,
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
      select: PUBLISHING_USER_SELECT,
    });

    if (user?.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can create content');
    }

    // Prohibited terms (minors, non-consent, escorting...) are refused even in drafts
    const textCheck = assertTextAllowed(dto.title, dto.description, dto.caption);

    // Everyone else appearing in the content must be a verified co-performer
    const soloContent = dto.soloContent ?? true;
    const coPerformerIds = await resolveContentCoPerformers(this.prisma, userId, soloContent, dto.coPerformerIds);

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

    // Publishing (now or scheduled) needs a verified identity; drafts don't
    const wantsPublication = !!dto.publish || !!scheduledFor;
    if (wantsPublication) {
      assertCanPublish(user);
    }

    // Created as a draft; publication goes through startPublication (review)
    const content = await this.prisma.content.create({
      data: {
        creatorId: userId,
        type: dto.type,
        visibility,
        status: 'DRAFT',
        publishedAt: null,
        title: dto.title,
        description: dto.description,
        caption: dto.caption,
        isPpv,
        ppvPrice: isPpv ? dto.ppvPrice : null,
        scheduledFor,
        soloContent,
        ...(coPerformerIds.length > 0 && {
          coPerformers: { create: coPerformerIds.map((coPerformerId) => ({ coPerformerId })) },
        }),
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

    this.logger.log(`Content created: ${content.id} by user ${userId}`);

    if (wantsPublication) {
      return this.startPublication(content.id, userId, scheduledFor, reviewNote(textCheck));
    }

    return content;
  }

  /**
   * Send content to publication. With pre-moderation (default, required by
   * the card networks for adult content) it goes UNDER_REVIEW until a
   * moderator approves it (moderateContent); scheduledFor is kept and
   * applied on approval. Without pre-moderation (CONTENT_PREMODERATION=false,
   * local dev only) it is published / scheduled right away, unless the text
   * has terms to review.
   */
  private async startPublication(
    contentId: string,
    creatorId: string,
    scheduledFor: Date | null,
    note: string | null,
  ) {
    const files = await this.prisma.contentFile.findMany({
      where: { contentId },
      select: { scanStatus: true },
    });
    if (files.some((file: any) => file.scanStatus === 'FLAGGED')) {
      throw new ForbiddenException('Ce contenu ne peut pas être publié');
    }

    const now = new Date();
    const premoderation = isContentPremoderationEnabled(this.configService, this.logger);

    let data: Record<string, any>;
    if (premoderation || note) {
      data = {
        status: 'UNDER_REVIEW',
        submittedForReviewAt: now,
        isModerated: false,
        moderationNotes: note,
        scheduledFor,
      };
    } else if (scheduledFor) {
      data = { status: 'DRAFT', scheduledFor };
    } else {
      data = { status: 'PUBLISHED', publishedAt: now, scheduledFor: null };
    }

    const updated = await this.prisma.content.update({
      where: { id: contentId },
      data,
      include: this.contentInclude,
    });

    if (data.status === 'PUBLISHED') {
      await this.refreshCreatorContentCount(creatorId);
    }

    const [serialized] = await this.withViewerAccess([updated], creatorId);
    return serialized;
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
          // The creator's own co-performers (never sent to fans)
          coPerformers: {
            select: {
              coPerformer: { select: { id: true, stageName: true, legalFirstName: true, status: true } },
            },
          },
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

    const textChanged = dto.title !== undefined || dto.description !== undefined || dto.caption !== undefined;
    const textCheck = textChanged
      ? assertTextAllowed(
          dto.title ?? content.title,
          dto.description ?? content.description,
          dto.caption ?? content.caption,
        )
      : null;

    // Co-performers: replaced when soloContent or coPerformerIds is given
    const coPerformersChanged = dto.soloContent !== undefined || dto.coPerformerIds !== undefined;
    const soloContent = dto.soloContent ?? content.soloContent ?? true;
    let coPerformerIds: string[] | undefined;
    if (coPerformersChanged) {
      let requested = dto.coPerformerIds;
      if (requested === undefined && !soloContent) {
        const current = await this.prisma.contentCoPerformer.findMany({
          where: { contentId },
          select: { coPerformerId: true },
        });
        requested = current.map((row: any) => row.coPerformerId);
      }
      coPerformerIds = await resolveContentCoPerformers(this.prisma, userId, soloContent, requested);
    }

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
        // Content waiting for review keeps its schedule, applied on approval
        if (content.status !== 'DRAFT' && content.status !== 'UNDER_REVIEW') {
          throw new BadRequestException('Only drafts can be scheduled');
        }
        scheduledFor = new Date(dto.scheduledFor);
        this.assertFutureDate(scheduledFor);
      } else {
        scheduledFor = null;
      }
    }

    // Visible (or approved and scheduled) content whose co-performers change,
    // or whose new text has terms to check, goes back to review
    const approvedScheduled = content.status === 'DRAFT' && !!content.scheduledFor && content.isModerated;
    const backToReview =
      (content.status === 'PUBLISHED' || approvedScheduled) &&
      (coPerformersChanged || !!textCheck?.needsReview) &&
      (isContentPremoderationEnabled(this.configService, this.logger) || !!textCheck?.needsReview);

    if (coPerformerIds !== undefined) {
      await this.prisma.contentCoPerformer.deleteMany({ where: { contentId } });
      if (coPerformerIds.length > 0) {
        await this.prisma.contentCoPerformer.createMany({
          data: coPerformerIds.map((coPerformerId) => ({ contentId, coPerformerId })),
          skipDuplicates: true,
        });
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
        ...(coPerformersChanged && { soloContent }),
        ...(backToReview && {
          status: 'UNDER_REVIEW',
          submittedForReviewAt: new Date(),
          isModerated: false,
          moderationNotes: (textCheck && reviewNote(textCheck)) || null,
        }),
        updatedAt: new Date(),
      },
      include: this.contentInclude,
    });

    if (backToReview && content.status === 'PUBLISHED') {
      await this.refreshCreatorContentCount(userId);
    }

    const [serialized] = await this.withViewerAccess([updated], userId);
    return serialized;
  }

  /**
   * Publish a draft now (or resubmit rejected content). With pre-moderation
   * the content goes UNDER_REVIEW and is published on approval.
   */
  async publishContent(userId: string, contentId: string) {
    const content = await this.findOwnContent(userId, contentId, 'publish');

    if (content.status === 'PUBLISHED') {
      throw new BadRequestException('Content is already published');
    }

    if (content.status === 'ARCHIVED') {
      throw new BadRequestException('Archived content must be unarchived');
    }

    // Content under review cannot bypass moderation
    if (content.status !== 'DRAFT' && content.status !== 'REJECTED') {
      throw new BadRequestException('Content under moderation cannot be published');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLISHING_USER_SELECT,
    });
    assertCanPublish(user);

    // Approved scheduled content published earlier than planned: already reviewed
    if (content.status === 'DRAFT' && content.scheduledFor && content.isModerated) {
      const published = await this.prisma.content.update({
        where: { id: contentId },
        data: { status: 'PUBLISHED', publishedAt: new Date(), scheduledFor: null },
        include: this.contentInclude,
      });
      await this.refreshCreatorContentCount(userId);
      const [serialized] = await this.withViewerAccess([published], userId);
      return serialized;
    }

    // Rules may have changed since the draft was written; co-performers may
    // have been deleted
    const textCheck = assertTextAllowed(content.title, content.description, content.caption);
    if (content.soloContent === false) {
      const current = await this.prisma.contentCoPerformer.findMany({
        where: { contentId },
        select: { coPerformerId: true },
      });
      await resolveContentCoPerformers(
        this.prisma,
        userId,
        false,
        current.map((row: any) => row.coPerformerId),
      );
    }

    return this.startPublication(contentId, userId, null, reviewNote(textCheck));
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
        // Only content approved by a moderator (pre-moderation)
        ...(isContentPremoderationEnabled(this.configService) && { isModerated: true }),
        files: { none: { scanStatus: 'FLAGGED' } },
        creator: { kycStatus: 'VERIFIED', status: { notIn: ['SUSPENDED', 'BANNED'] } },
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

  /**
   * Approve or reject content waiting for review (UNDER_REVIEW).
   * Approval publishes it, or keeps it scheduled when scheduledFor is still in
   * the future (published by publishScheduledContent). Rejection requires a
   * reason, shown to the creator.
   */
  async moderateContent(moderatorId: string, contentId: string, approved: boolean, notes?: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      include: {
        files: { select: { id: true, scanStatus: true } },
        coPerformers: { select: { coPerformer: { select: { id: true, status: true, deletedAt: true } } } },
        creator: { select: { id: true, kycStatus: true, status: true } },
      },
    });

    if (!content || content.deletedAt) {
      throw new NotFoundException('Content not found');
    }

    if (content.status !== 'UNDER_REVIEW') {
      throw new BadRequestException("Ce contenu n'est pas en attente de validation");
    }

    const reason = notes?.trim() || null;
    const now = new Date();
    let data: Record<string, any>;

    if (approved) {
      const files: any[] = (content as any).files ?? [];
      if (files.some((file) => file.scanStatus === 'FLAGGED')) {
        throw new BadRequestException('Un média de ce contenu a été signalé : approbation impossible');
      }
      if (isMediaScanConfigured(this.configService) && files.some((file) => file.scanStatus === 'PENDING')) {
        throw new BadRequestException("L'analyse des médias n'est pas terminée");
      }

      const creator: any = (content as any).creator;
      if (creator?.kycStatus !== 'VERIFIED') {
        throw new BadRequestException("L'identité du créateur n'est pas vérifiée");
      }

      const coPerformers = ((content as any).coPerformers ?? []).map((row: any) => row.coPerformer);
      if (content.soloContent === false) {
        if (coPerformers.length === 0) {
          throw new BadRequestException('Aucun co-participant déclaré pour ce contenu');
        }
        if (coPerformers.some((coPerformer: any) => coPerformer.status !== 'VERIFIED' || coPerformer.deletedAt)) {
          throw new BadRequestException("Tous les co-participants doivent être vérifiés");
        }
      }

      const stillScheduled = !!content.scheduledFor && content.scheduledFor.getTime() > now.getTime();
      data = {
        isModerated: true,
        moderatedAt: now,
        moderatedBy: moderatorId,
        moderationNotes: reason,
        status: stillScheduled ? 'DRAFT' : 'PUBLISHED',
        // Content re-reviewed after a report / an edit keeps its publication date
        publishedAt: stillScheduled ? content.publishedAt : content.publishedAt ?? now,
        scheduledFor: stillScheduled ? content.scheduledFor : null,
      };
    } else {
      if (!reason) {
        throw new BadRequestException('Un motif est requis pour refuser un contenu');
      }
      data = {
        isModerated: true,
        moderatedAt: now,
        moderatedBy: moderatorId,
        moderationNotes: reason,
        status: 'REJECTED',
      };
    }

    const updated = await this.prisma.content.update({
      where: { id: contentId },
      data,
    });

    await this.refreshCreatorContentCount(content.creatorId);

    const title = content.title || 'Sans titre';
    try {
      await this.prisma.notification.create({
        data: {
          userId: content.creatorId,
          type: approved ? 'CONTENT_APPROVED' : 'CONTENT_REJECTED',
          title: approved ? 'Contenu validé' : 'Contenu refusé',
          message: approved
            ? data.status === 'DRAFT'
              ? `Votre contenu "${title}" a été validé et sera publié à la date prévue.`
              : `Votre contenu "${title}" a été validé et est maintenant publié.`
            : `Votre contenu "${title}" a été refusé. Motif : ${reason}`,
          linkUrl: approved ? `/content/${contentId}` : '/creator/content?status=REVIEW',
          metadata: { contentId },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to notify creator of moderation decision: ${error.message}`);
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: moderatorId,
          action: approved ? 'CONTENT_APPROVED' : 'CONTENT_REJECTED',
          resource: 'CONTENT',
          resourceId: contentId,
          metadata: { reason, scheduledFor: data.scheduledFor ?? null },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for content ${contentId}: ${error.message}`);
    }

    return updated;
  }

  /**
   * Review queue: content waiting for a moderator (oldest submission first),
   * with signed media URLs, scan status, declared co-performers and their
   * verification, creator KYC and the text rule matches.
   */
  async getContentForModeration(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const where = { status: 'UNDER_REVIEW' as const, deletedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.content.findMany({
        where,
        include: this.reviewInclude,
        orderBy: [{ submittedForReviewAt: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.content.count({ where }),
    ]);

    return {
      items: await Promise.all(items.map((item: any) => this.serializeForReview(item))),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** One content as moderators see it (any status) */
  async getContentForReview(contentId: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      include: this.reviewInclude,
    });
    if (!content) {
      throw new NotFoundException('Content not found');
    }
    return this.serializeForReview(content);
  }

  private readonly reviewInclude = {
    creator: {
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        kycStatus: true,
        status: true,
      },
    },
    files: { orderBy: { order: 'asc' as const } },
    coPerformers: {
      select: {
        coPerformer: {
          select: {
            id: true,
            legalFirstName: true,
            legalLastName: true,
            stageName: true,
            dateOfBirth: true,
            status: true,
            consentSignedAt: true,
            deletedAt: true,
          },
        },
      },
    },
  };

  private async serializeForReview(content: any) {
    const { files = [], coPerformers = [], ppvPrice, ...rest } = content;

    const media = await Promise.all(
      files.map(async (file: any) => {
        const flagged = file.scanStatus === 'FLAGGED';
        return {
          id: file.id,
          mimeType: file.mimeType,
          type: file.mimeType?.startsWith('image/')
            ? 'IMAGE'
            : file.mimeType?.startsWith('video/')
              ? 'VIDEO'
              : file.mimeType?.startsWith('audio/')
                ? 'AUDIO'
                : 'FILE',
          size: Number(file.size ?? 0),
          scanStatus: file.scanStatus,
          // Flagged media are evidence: never displayed, even to moderators
          url: flagged ? null : await this.storageService.getSignedUrl(file.storagePath, REVIEW_URL_TTL_SECONDS),
          thumbnailUrl:
            flagged || !file.thumbnailPath
              ? null
              : await this.storageService.getSignedUrl(file.thumbnailPath, REVIEW_URL_TTL_SECONDS),
        };
      }),
    );

    return {
      ...rest,
      ppvPrice: ppvPrice != null ? Number(ppvPrice) : null,
      files: media,
      coPerformers: coPerformers.map((row: any) => row.coPerformer),
      textCheck: checkText(content.title, content.description, content.caption),
      urlExpiresInSeconds: REVIEW_URL_TTL_SECONDS,
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
   * Start a PPV purchase (price excluding VAT, VAT added at checkout). Access
   * is granted only once the payment succeeds (saved card charge or provider webhook).
   */
  async unlockContent(userId: string, contentId: string, options: PurchaseOptions = {}) {
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

    const payment = await this.paymentFlow.startPayment({
      ...options,
      payerId: userId,
      creatorId: content.creatorId,
      kind: 'content_unlock',
      amount: Number(content.ppvPrice),
      contentId,
      description: `Contenu PPV de @${content.creator.username}`,
      returnPath: `/content/${contentId}`,
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
   * State of a PPV payment (after the provider's payment page, idempotent)
   */
  async confirmUnlock(userId: string, contentId: string, transactionId: string) {
    const payment = await this.paymentFlow.confirmPayment(userId, transactionId, {
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
    const { files: allFiles = [], ...rest } = content;
    // Media matching known illegal content are never served (MediaScanService)
    const files = allFiles.filter((file: any) => file.scanStatus !== 'FLAGGED');

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
