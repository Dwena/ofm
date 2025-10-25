import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';

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

    const creatorIds = subscriptions.map((sub) => sub.tier.creatorId);

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

  // TODO: Implement content creation, upload, moderation, etc.
}
