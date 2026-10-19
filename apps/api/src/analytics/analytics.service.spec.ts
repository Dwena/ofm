import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { AnalyticsInterval } from './dto/analytics.dto';
import { PrismaService } from '../common/database/prisma.service';
import { RedisService } from '../common/redis/redis.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  const mockPrismaService = {
    user: { findUnique: jest.fn() },
    content: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    subscription: { count: jest.fn(), findMany: jest.fn() },
    transaction: { aggregate: jest.fn() },
    contentLike: { findMany: jest.fn() },
    comment: { findMany: jest.fn() },
  };

  const mockRedisService = {
    memoize: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
  };

  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get(AnalyticsService);
    jest.clearAllMocks();
    mockPrismaService.user.findUnique.mockResolvedValue({ id: 'creator-1', role: 'CREATOR' });
  });

  it('refuses non creators', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({ id: 'fan-1', role: 'SUBSCRIBER' });
    await expect(service.getSubscriberGrowth('fan-1', {})).rejects.toThrow(ForbiddenException);
  });

  describe('getSubscriberGrowth', () => {
    it('returns one bucket per period and counts cancellations of older subscriptions', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { createdAt: daysAgo(2), status: 'ACTIVE', cancelledAt: null },
        { createdAt: daysAgo(1), status: 'ACTIVE', cancelledAt: null },
        // Started before the range, cancelled inside it
        { createdAt: daysAgo(60), status: 'CANCELLED', cancelledAt: daysAgo(1) },
      ]);

      const result = await service.getSubscriberGrowth('creator-1', {
        interval: AnalyticsInterval.DAY,
        periods: 7,
      });

      expect(result.periods).toHaveLength(7);
      expect(result.periods[6].period).toBe(new Date().toISOString().slice(0, 10));
      expect(result.totals).toEqual({ totalNewSubscribers: 2, totalCancelled: 1, netGrowth: 1 });
      expect(mockPrismaService.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: [{ createdAt: expect.any(Object) }, { cancelledAt: expect.any(Object) }] }),
        }),
      );
    });
  });

  describe('getEngagementStats', () => {
    it('groups likes and comments per period without gaps', async () => {
      mockPrismaService.contentLike.findMany.mockResolvedValue([{ createdAt: daysAgo(0) }, { createdAt: daysAgo(0) }]);
      mockPrismaService.comment.findMany.mockResolvedValue([{ createdAt: daysAgo(3) }]);
      mockPrismaService.subscription.findMany.mockResolvedValue([]);

      const result = await service.getEngagementStats('creator-1', { interval: AnalyticsInterval.WEEK, periods: 4 });

      expect(result.periods).toHaveLength(4);
      expect(result.totals).toEqual(
        expect.objectContaining({ totalLikes: 2, totalComments: 1, totalInteractions: 3, totalNewSubscribers: 0 }),
      );
    });
  });

  describe('getOverview', () => {
    it('returns the current and previous month revenue in euros', async () => {
      mockPrismaService.content.aggregate.mockResolvedValue({ _sum: { viewCount: 100, likeCount: 10, commentCount: 5 } });
      mockPrismaService.subscription.count.mockResolvedValue(3);
      mockPrismaService.content.count.mockResolvedValue(4);
      mockPrismaService.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { netAmount: new Prisma.Decimal('42.5') } })
        .mockResolvedValueOnce({ _sum: { netAmount: new Prisma.Decimal('17.25') } });
      mockPrismaService.content.findMany.mockResolvedValue([]);

      const result = await service.getOverview('creator-1');

      expect(result.summary).toEqual(
        expect.objectContaining({ totalViews: 100, monthlyRevenue: 42.5, previousMonthRevenue: 17.25 }),
      );
    });
  });

  describe('getDetailedReport', () => {
    it('computes the engagement rate per content type', async () => {
      mockPrismaService.content.aggregate.mockResolvedValue({ _sum: {} });
      mockPrismaService.subscription.count.mockResolvedValue(0);
      mockPrismaService.content.count.mockResolvedValue(0);
      mockPrismaService.transaction.aggregate.mockResolvedValue({ _sum: {} });
      mockPrismaService.content.findMany.mockResolvedValue([]);
      mockPrismaService.contentLike.findMany.mockResolvedValue([]);
      mockPrismaService.comment.findMany.mockResolvedValue([]);
      mockPrismaService.subscription.findMany.mockResolvedValue([]);
      mockPrismaService.content.groupBy.mockResolvedValue([
        { type: 'PHOTO', _count: { id: 2 }, _sum: { viewCount: 200, likeCount: 15, commentCount: 5 } },
      ]);

      const report = await service.getDetailedReport('creator-1', { interval: AnalyticsInterval.MONTH, periods: 3 });

      expect(report.contentBreakdown).toEqual([
        expect.objectContaining({ type: 'PHOTO', count: 2, avgViewsPerContent: 100, engagementRate: 10 }),
      ]);
      expect(report.contentAnalytics.periods).toHaveLength(3);
    });
  });
});
