import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { SearchContentDto, ContentSortBy } from './dto/search-content.dto';

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(private prisma: PrismaService) {}

  async getCreatorContent(creatorId: string, userId?: string) {
    return this.prisma.content.findMany({
      where: {
        creatorId,
        status: 'PUBLISHED',
        deletedAt: null,
      },
      include: {
        files: true,
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
      orderBy: {
        publishedAt: 'desc',
      },
    });
  }

  async getFeed(userId: string, page: number = 1, limit: number = 20) {
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

    // Get content from subscribed creators
    return this.prisma.content.findMany({
      where: {
        creatorId: {
          in: creatorIds,
        },
        status: 'PUBLISHED',
        deletedAt: null,
        OR: [
          { visibility: 'SUBSCRIBERS_ONLY' },
          { visibility: 'PUBLIC' },
        ],
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
        files: true,
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
      orderBy: {
        publishedAt: 'desc',
      },
      skip,
      take: limit,
    });
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
    return this.prisma.content.update({
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
      include: {
        files: true,
      },
    });
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

    return this.prisma.content.update({
      where: { id: contentId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      include: {
        files: true,
      },
    });
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

    if (visibility) {
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
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
          files: true,
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.content.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getContentById(contentId: string, userId?: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        files: true,
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    });

    if (!content || content.deletedAt) {
      throw new NotFoundException('Content not found');
    }

    // Increment view count
    await this.prisma.content.update({
      where: { id: contentId },
      data: { viewCount: { increment: 1 } },
    });

    return content;
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
}
