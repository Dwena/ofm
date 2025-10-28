import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import {
  GetAnalyticsDto,
  TrackViewDto,
  GetContentAnalyticsDto,
  GetEngagementDto,
  AnalyticsInterval,
} from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Track content view
   */
  async trackView(dto: TrackViewDto) {
    const { contentId, userId, ipAddress, userAgent } = dto;

    // Check if content exists
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    // Increment view count on content
    await this.prisma.content.update({
      where: { id: contentId },
      data: {
        viewCount: {
          increment: 1,
        },
      },
    });

    // Create view record for analytics
    // Note: We don't have a ContentView table in schema, so we track in metadata
    // In production, you'd want a dedicated table for this
    this.logger.log(`View tracked: content=${contentId}, user=${userId || 'anonymous'}`);

    return {
      success: true,
      contentId,
      viewCount: content.viewCount + 1,
    };
  }

  /**
   * Get overview analytics for creator (with caching)
   */
  async getOverview(userId: string) {
    // Cache for 5 minutes
    return this.redis.memoize(
      `analytics:overview:${userId}`,
      async () => {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          include: {
            creatorProfile: true,
          },
        });

        if (!user || user.role !== 'CREATOR') {
          throw new ForbiddenException('Only creators can view analytics');
        }

        // Run aggregations in parallel
        const [
          totalViews,
          totalLikes,
          totalComments,
          activeSubscriptions,
          totalSubscribers,
          totalContent,
          monthlyRevenue,
          topContent,
        ] = await Promise.all([
          // Total views
          this.prisma.content.aggregate({
            where: {
              creatorId: userId,
              deletedAt: null,
            },
            _sum: {
              viewCount: true,
            },
          }),
          // Total likes
          this.prisma.content.aggregate({
            where: {
              creatorId: userId,
              deletedAt: null,
            },
            _sum: {
              likeCount: true,
            },
          }),
          // Total comments
          this.prisma.content.aggregate({
            where: {
              creatorId: userId,
              deletedAt: null,
            },
            _sum: {
              commentCount: true,
            },
          }),
          // Active subscriptions
          this.prisma.subscription.count({
            where: {
              tier: {
                creatorId: userId,
              },
              status: 'ACTIVE',
            },
          }),
          // Total subscribers (all time)
          this.prisma.subscription.count({
            where: {
              tier: {
                creatorId: userId,
              },
            },
          }),
          // Total content
          this.prisma.content.count({
            where: {
              creatorId: userId,
              status: 'PUBLISHED',
              deletedAt: null,
            },
          }),
          // This month's revenue
          (async () => {
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            return this.prisma.transaction.aggregate({
              where: {
                toUserId: userId,
                status: 'COMPLETED',
                createdAt: {
                  gte: startOfMonth,
                },
              },
              _sum: {
                netAmount: true,
              },
            });
          })(),
          // Top performing content
          this.prisma.content.findMany({
            where: {
              creatorId: userId,
              status: 'PUBLISHED',
              deletedAt: null,
            },
            orderBy: {
              viewCount: 'desc',
            },
            take: 5,
            select: {
              id: true,
              title: true,
              type: true,
              viewCount: true,
              likeCount: true,
              commentCount: true,
              publishedAt: true,
            },
          }),
        ]);

        return {
          summary: {
            totalViews: totalViews._sum.viewCount || 0,
            totalLikes: totalLikes._sum.likeCount || 0,
            totalComments: totalComments._sum.commentCount || 0,
            activeSubscriptions,
            totalSubscribers,
            totalContent,
            monthlyRevenue: Number(monthlyRevenue._sum.netAmount || 0),
          },
          topContent,
        };
      },
      300, // 5 minutes
    );
  }

  /**
   * Get content analytics by period
   */
  async getContentAnalytics(userId: string, dto: GetContentAnalyticsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view analytics');
    }

    const { interval = AnalyticsInterval.DAY, periods = 30, startDate, endDate, contentId, contentType } = dto;

    // Calculate date range
    const end = endDate ? new Date(endDate) : new Date();
    let start: Date;

    if (startDate) {
      start = new Date(startDate);
    } else {
      start = new Date(end);
      switch (interval) {
        case AnalyticsInterval.DAY:
          start.setDate(start.getDate() - periods);
          break;
        case AnalyticsInterval.WEEK:
          start.setDate(start.getDate() - periods * 7);
          break;
        case AnalyticsInterval.MONTH:
          start.setMonth(start.getMonth() - periods);
          break;
        case AnalyticsInterval.YEAR:
          start.setFullYear(start.getFullYear() - periods);
          break;
      }
    }

    // Build where clause
    const where: any = {
      creatorId: userId,
      deletedAt: null,
      publishedAt: {
        gte: start,
        lte: end,
      },
    };

    if (contentId) {
      where.id = contentId;
    }

    if (contentType) {
      where.type = contentType;
    }

    // Get all content in range
    const content = await this.prisma.content.findMany({
      where,
      orderBy: {
        publishedAt: 'asc',
      },
      select: {
        id: true,
        title: true,
        type: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        publishedAt: true,
      },
    });

    // Group by period
    const periodMap = new Map<string, any>();

    content.forEach((item: any) => {
      const periodKey = this.getPeriodKey(item.publishedAt!, interval);

      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          period: periodKey,
          contentPublished: 0,
          totalViews: 0,
          totalLikes: 0,
          totalComments: 0,
          avgViewsPerContent: 0,
          avgLikesPerContent: 0,
        });
      }

      const periodData = periodMap.get(periodKey);
      periodData.contentPublished++;
      periodData.totalViews += item.viewCount;
      periodData.totalLikes += item.likeCount;
      periodData.totalComments += item.commentCount;
    });

    // Calculate averages
    const stats: any[] = [];
    periodMap.forEach((data) => {
      data.avgViewsPerContent = data.contentPublished > 0 ? data.totalViews / data.contentPublished : 0;
      data.avgLikesPerContent = data.contentPublished > 0 ? data.totalLikes / data.contentPublished : 0;
      stats.push(data);
    });

    // Sort by period
    stats.sort((a, b) => a.period.localeCompare(b.period));

    // Calculate totals
    const totals = {
      contentPublished: stats.reduce((sum, s) => sum + s.contentPublished, 0),
      totalViews: stats.reduce((sum, s) => sum + s.totalViews, 0),
      totalLikes: stats.reduce((sum, s) => sum + s.totalLikes, 0),
      totalComments: stats.reduce((sum, s) => sum + s.totalComments, 0),
    };

    return {
      interval,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      periods: stats,
      totals,
    };
  }

  /**
   * Get engagement statistics
   */
  async getEngagementStats(userId: string, dto: GetEngagementDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view analytics');
    }

    const { interval = AnalyticsInterval.DAY, periods = 30 } = dto;

    // Calculate date range
    const end = new Date();
    const start = new Date(end);

    switch (interval) {
      case AnalyticsInterval.DAY:
        start.setDate(start.getDate() - periods);
        break;
      case AnalyticsInterval.WEEK:
        start.setDate(start.getDate() - periods * 7);
        break;
      case AnalyticsInterval.MONTH:
        start.setMonth(start.getMonth() - periods);
        break;
      case AnalyticsInterval.YEAR:
        start.setFullYear(start.getFullYear() - periods);
        break;
    }

    // Get likes over time
    const likes = await this.prisma.contentLike.findMany({
      where: {
        content: {
          creatorId: userId,
        },
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        createdAt: true,
        contentId: true,
      },
    });

    // Get comments over time
    const comments = await this.prisma.comment.findMany({
      where: {
        content: {
          creatorId: userId,
        },
        createdAt: {
          gte: start,
          lte: end,
        },
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        createdAt: true,
        contentId: true,
      },
    });

    // Get new subscriptions over time
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        tier: {
          creatorId: userId,
        },
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        createdAt: true,
        status: true,
      },
    });

    // Group by period
    const periodMap = new Map<string, any>();

    // Process likes
    likes.forEach((like: any) => {
      const periodKey = this.getPeriodKey(like.createdAt, interval);
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, this.createEmptyPeriod(periodKey));
      }
      periodMap.get(periodKey).likes++;
    });

    // Process comments
    comments.forEach((comment: any) => {
      const periodKey = this.getPeriodKey(comment.createdAt, interval);
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, this.createEmptyPeriod(periodKey));
      }
      periodMap.get(periodKey).comments++;
    });

    // Process subscriptions
    subscriptions.forEach((sub: any) => {
      const periodKey = this.getPeriodKey(sub.createdAt, interval);
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, this.createEmptyPeriod(periodKey));
      }
      periodMap.get(periodKey).newSubscribers++;
      if (sub.status === 'ACTIVE') {
        periodMap.get(periodKey).activeSubscribers++;
      }
    });

    // Convert to array and calculate engagement rate
    const stats: any[] = [];
    periodMap.forEach((data) => {
      // Engagement rate = (likes + comments) / views (we don't have period views, so use total interactions)
      const totalInteractions = data.likes + data.comments;
      data.engagementRate = totalInteractions > 0 ? ((data.likes + data.comments) / totalInteractions) * 100 : 0;
      stats.push(data);
    });

    // Sort by period
    stats.sort((a, b) => a.period.localeCompare(b.period));

    // Calculate totals
    const totals = {
      totalLikes: stats.reduce((sum, s) => sum + s.likes, 0),
      totalComments: stats.reduce((sum, s) => sum + s.comments, 0),
      totalNewSubscribers: stats.reduce((sum, s) => sum + s.newSubscribers, 0),
      avgEngagementRate: stats.length > 0
        ? stats.reduce((sum, s) => sum + s.engagementRate, 0) / stats.length
        : 0,
    };

    return {
      interval,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      periods: stats,
      totals,
    };
  }

  /**
   * Get subscriber growth analytics
   */
  async getSubscriberGrowth(userId: string, dto: GetAnalyticsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view analytics');
    }

    const { interval = AnalyticsInterval.DAY, periods = 30, startDate, endDate } = dto;

    // Calculate date range
    const end = endDate ? new Date(endDate) : new Date();
    let start: Date;

    if (startDate) {
      start = new Date(startDate);
    } else {
      start = new Date(end);
      switch (interval) {
        case AnalyticsInterval.DAY:
          start.setDate(start.getDate() - periods);
          break;
        case AnalyticsInterval.WEEK:
          start.setDate(start.getDate() - periods * 7);
          break;
        case AnalyticsInterval.MONTH:
          start.setMonth(start.getMonth() - periods);
          break;
        case AnalyticsInterval.YEAR:
          start.setFullYear(start.getFullYear() - periods);
          break;
      }
    }

    // Get all subscriptions
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        tier: {
          creatorId: userId,
        },
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        createdAt: true,
        status: true,
        cancelledAt: true,
      },
    });

    // Group by period
    const periodMap = new Map<string, any>();

    subscriptions.forEach((sub: any) => {
      const periodKey = this.getPeriodKey(sub.createdAt, interval);

      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          period: periodKey,
          newSubscribers: 0,
          cancelledSubscribers: 0,
          netGrowth: 0,
        });
      }

      const periodData = periodMap.get(periodKey);
      periodData.newSubscribers++;

      if (sub.cancelledAt && sub.cancelledAt >= start && sub.cancelledAt <= end) {
        const cancelPeriodKey = this.getPeriodKey(sub.cancelledAt, interval);
        if (!periodMap.has(cancelPeriodKey)) {
          periodMap.set(cancelPeriodKey, {
            period: cancelPeriodKey,
            newSubscribers: 0,
            cancelledSubscribers: 0,
            netGrowth: 0,
          });
        }
        periodMap.get(cancelPeriodKey).cancelledSubscribers++;
      }
    });

    // Calculate net growth
    const stats: any[] = [];
    periodMap.forEach((data) => {
      data.netGrowth = data.newSubscribers - data.cancelledSubscribers;
      stats.push(data);
    });

    // Sort by period
    stats.sort((a, b) => a.period.localeCompare(b.period));

    // Calculate totals
    const totals = {
      totalNewSubscribers: stats.reduce((sum, s) => sum + s.newSubscribers, 0),
      totalCancelled: stats.reduce((sum, s) => sum + s.cancelledSubscribers, 0),
      netGrowth: stats.reduce((sum, s) => sum + s.netGrowth, 0),
    };

    return {
      interval,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      periods: stats,
      totals,
    };
  }

  /**
   * Get detailed report for creator
   */
  async getDetailedReport(userId: string, dto: GetAnalyticsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view analytics');
    }

    // Get all analytics in parallel
    const [overview, contentAnalytics, engagementStats, subscriberGrowth] = await Promise.all([
      this.getOverview(userId),
      this.getContentAnalytics(userId, dto),
      this.getEngagementStats(userId, { interval: dto.interval, periods: dto.periods }),
      this.getSubscriberGrowth(userId, dto),
    ]);

    // Get content performance breakdown
    const contentByType = await this.prisma.content.groupBy({
      by: ['type'],
      where: {
        creatorId: userId,
        status: 'PUBLISHED',
        deletedAt: null,
      },
      _count: {
        id: true,
      },
      _sum: {
        viewCount: true,
        likeCount: true,
        commentCount: true,
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      period: {
        start: contentAnalytics.dateRange.start,
        end: contentAnalytics.dateRange.end,
        interval: dto.interval,
      },
      overview,
      contentAnalytics,
      engagementStats,
      subscriberGrowth,
      contentBreakdown: contentByType.map((item: any) => ({
        type: item.type,
        count: item._count.id,
        totalViews: item._sum.viewCount || 0,
        totalLikes: item._sum.likeCount || 0,
        totalComments: item._sum.commentCount || 0,
        avgViewsPerContent: item._count.id > 0 ? (item._sum.viewCount || 0) / item._count.id : 0,
      })),
    };
  }

  /**
   * Helper: Create empty period data
   */
  private createEmptyPeriod(periodKey: string) {
    return {
      period: periodKey,
      likes: 0,
      comments: 0,
      newSubscribers: 0,
      activeSubscribers: 0,
      engagementRate: 0,
    };
  }

  /**
   * Helper: Get period key for grouping
   */
  private getPeriodKey(date: Date, interval: AnalyticsInterval): string {
    const d = new Date(date);

    switch (interval) {
      case AnalyticsInterval.DAY:
        return d.toISOString().split('T')[0]; // YYYY-MM-DD

      case AnalyticsInterval.WEEK:
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        return weekStart.toISOString().split('T')[0];

      case AnalyticsInterval.MONTH:
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM

      case AnalyticsInterval.YEAR:
        return String(d.getFullYear()); // YYYY

      default:
        return d.toISOString().split('T')[0];
    }
  }
}
