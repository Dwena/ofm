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
import { createPeriodMap, getPeriodKey, resolvePeriodRange } from '../common/utils/periods';
import { roundMoney } from '../common/utils/money';

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
          previousMonthRevenue,
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
          // Last month's revenue (for the month-over-month trend)
          (async () => {
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);
            const startOfPreviousMonth = new Date(startOfMonth);
            startOfPreviousMonth.setMonth(startOfPreviousMonth.getMonth() - 1);

            return this.prisma.transaction.aggregate({
              where: {
                toUserId: userId,
                status: 'COMPLETED',
                createdAt: {
                  gte: startOfPreviousMonth,
                  lt: startOfMonth,
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
            monthlyRevenue: roundMoney(Number(monthlyRevenue._sum.netAmount || 0)),
            previousMonthRevenue: roundMoney(Number(previousMonthRevenue._sum.netAmount || 0)),
          },
          topContent,
        };
      },
      300, // 5 minutes
    );
  }

  /**
   * Get content analytics by period (content published in each period and
   * the views/likes/comments it gathered)
   */
  async getContentAnalytics(userId: string, dto: GetContentAnalyticsDto) {
    await this.assertCreator(userId);

    const { interval = AnalyticsInterval.DAY, periods = 30, startDate, endDate, contentId, contentType } = dto;
    const { start, end } = resolvePeriodRange(interval, periods, startDate, endDate);

    // Build where clause
    const where: any = {
      creatorId: userId,
      status: 'PUBLISHED',
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

    const periodMap = createPeriodMap(start, end, interval, (period) => ({
      period,
      contentPublished: 0,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      avgViewsPerContent: 0,
      avgLikesPerContent: 0,
    }));

    content.forEach((item: any) => {
      const periodData = periodMap.get(getPeriodKey(item.publishedAt!, interval));
      if (!periodData) return;
      periodData.contentPublished++;
      periodData.totalViews += item.viewCount;
      periodData.totalLikes += item.likeCount;
      periodData.totalComments += item.commentCount;
    });

    const stats = Array.from(periodMap.values()).map((data) => ({
      ...data,
      avgViewsPerContent: data.contentPublished > 0 ? data.totalViews / data.contentPublished : 0,
      avgLikesPerContent: data.contentPublished > 0 ? data.totalLikes / data.contentPublished : 0,
    }));

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
   * Get engagement statistics (likes, comments and new subscribers per period)
   */
  async getEngagementStats(userId: string, dto: GetEngagementDto) {
    await this.assertCreator(userId);

    const { interval = AnalyticsInterval.DAY, periods = 30 } = dto;
    const { start, end } = resolvePeriodRange(interval, periods);
    const range = { gte: start, lte: end };

    const [likes, comments, subscriptions] = await Promise.all([
      this.prisma.contentLike.findMany({
        where: { content: { creatorId: userId }, createdAt: range },
        select: { createdAt: true },
      }),
      this.prisma.comment.findMany({
        where: { content: { creatorId: userId }, createdAt: range, deletedAt: null },
        select: { createdAt: true },
      }),
      this.prisma.subscription.findMany({
        where: { tier: { creatorId: userId }, createdAt: range },
        select: { createdAt: true, status: true },
      }),
    ]);

    const periodMap = createPeriodMap(start, end, interval, (period) => ({
      period,
      likes: 0,
      comments: 0,
      interactions: 0,
      newSubscribers: 0,
      activeSubscribers: 0,
    }));
    const bucket = (date: Date) => periodMap.get(getPeriodKey(date, interval));

    likes.forEach((like: any) => {
      const data = bucket(like.createdAt);
      if (data) data.likes++;
    });

    comments.forEach((comment: any) => {
      const data = bucket(comment.createdAt);
      if (data) data.comments++;
    });

    subscriptions.forEach((sub: any) => {
      const data = bucket(sub.createdAt);
      if (!data) return;
      data.newSubscribers++;
      if (sub.status === 'ACTIVE') {
        data.activeSubscribers++;
      }
    });

    const stats = Array.from(periodMap.values()).map((data) => ({
      ...data,
      interactions: data.likes + data.comments,
    }));

    const totals = {
      totalLikes: stats.reduce((sum, s) => sum + s.likes, 0),
      totalComments: stats.reduce((sum, s) => sum + s.comments, 0),
      totalInteractions: stats.reduce((sum, s) => sum + s.interactions, 0),
      totalNewSubscribers: stats.reduce((sum, s) => sum + s.newSubscribers, 0),
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
   * Get subscriber growth analytics: subscriptions started and cancelled in
   * each period (a cancellation counts even when the subscription started earlier)
   */
  async getSubscriberGrowth(userId: string, dto: GetAnalyticsDto) {
    await this.assertCreator(userId);

    const { interval = AnalyticsInterval.DAY, periods = 30, startDate, endDate } = dto;
    const { start, end } = resolvePeriodRange(interval, periods, startDate, endDate);
    const range = { gte: start, lte: end };

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        tier: {
          creatorId: userId,
        },
        OR: [{ createdAt: range }, { cancelledAt: range }],
      },
      select: {
        createdAt: true,
        status: true,
        cancelledAt: true,
      },
    });

    const periodMap = createPeriodMap(start, end, interval, (period) => ({
      period,
      newSubscribers: 0,
      cancelledSubscribers: 0,
      netGrowth: 0,
    }));

    subscriptions.forEach((sub: any) => {
      if (sub.createdAt >= start && sub.createdAt <= end) {
        const data = periodMap.get(getPeriodKey(sub.createdAt, interval));
        if (data) data.newSubscribers++;
      }
      if (sub.cancelledAt && sub.cancelledAt >= start && sub.cancelledAt <= end) {
        const data = periodMap.get(getPeriodKey(sub.cancelledAt, interval));
        if (data) data.cancelledSubscribers++;
      }
    });

    const stats = Array.from(periodMap.values()).map((data) => ({
      ...data,
      netGrowth: data.newSubscribers - data.cancelledSubscribers,
    }));

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
    await this.assertCreator(userId);

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
      contentBreakdown: contentByType.map((item: any) => {
        const views = item._sum.viewCount || 0;
        const likes = item._sum.likeCount || 0;
        const comments = item._sum.commentCount || 0;
        return {
          type: item.type,
          count: item._count.id,
          totalViews: views,
          totalLikes: likes,
          totalComments: comments,
          avgViewsPerContent: item._count.id > 0 ? views / item._count.id : 0,
          // (likes + comments) / views, in percent
          engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
        };
      }),
    };
  }

  private async assertCreator(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view analytics');
    }
  }
}
