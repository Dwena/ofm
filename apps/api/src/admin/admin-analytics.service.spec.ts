import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminAnalyticsService, buildBuckets, truncateDate } from './admin-analytics.service';
import { PrismaService } from '../common/database/prisma.service';
import { AnalyticsInterval } from './dto/admin.dto';

describe('AdminAnalyticsService', () => {
  let service: AdminAnalyticsService;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
    transaction: { groupBy: jest.fn() },
    subscription: { count: jest.fn() },
    user: { count: jest.fn(), findMany: jest.fn() },
    report: { findMany: jest.fn(), count: jest.fn() },
    auditLog: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminAnalyticsService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get(AdminAnalyticsService);
    jest.clearAllMocks();
  });

  describe('buckets', () => {
    it('truncates weeks to Monday and months to the 1st (UTC)', () => {
      expect(truncateDate(new Date('2026-10-18T22:00:00Z'), AnalyticsInterval.WEEK).toISOString()).toBe(
        '2026-10-12T00:00:00.000Z',
      );
      expect(truncateDate(new Date('2026-10-18T22:00:00Z'), AnalyticsInterval.MONTH).toISOString()).toBe(
        '2026-10-01T00:00:00.000Z',
      );
    });

    it('lists every bucket of the period', () => {
      expect(
        buildBuckets(new Date('2026-10-01T10:00:00Z'), new Date('2026-10-03T08:00:00Z'), AnalyticsInterval.DAY),
      ).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    });
  });

  describe('getAnalytics', () => {
    it('fills a zeroed time series and returns euros', async () => {
      mockPrismaService.$queryRaw
        // revenue
        .mockResolvedValueOnce([{ bucket: new Date('2026-10-02T00:00:00Z'), revenue: 120.5, fees: 18.08, count: 3 }])
        // users
        .mockResolvedValueOnce([{ bucket: new Date('2026-10-01T00:00:00Z'), users: 4, creators: 1 }])
        // content
        .mockResolvedValueOnce([{ bucket: new Date('2026-10-03T00:00:00Z'), uploads: 2 }])
        // new subscriptions
        .mockResolvedValueOnce([])
        // cancellations
        .mockResolvedValueOnce([]);
      mockPrismaService.transaction.groupBy
        .mockResolvedValueOnce([{ type: 'TIP', _sum: { amount: 120.5, platformFee: 18.08 }, _count: { id: 3 } }])
        .mockResolvedValueOnce([
          { toUserId: 'c1', _sum: { amount: 120.5, platformFee: 18.08, netAmount: 102.42 }, _count: { id: 3 } },
        ]);
      mockPrismaService.subscription.count.mockResolvedValue(7);
      mockPrismaService.user.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2);
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'c1', username: 'alice', creatorProfile: { totalSubscribers: 5 } },
      ]);

      const result = await service.getAnalytics({
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2026-10-03T23:59:59Z',
        interval: AnalyticsInterval.DAY,
      });

      expect(result.series.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
      expect(result.series[1]).toEqual(expect.objectContaining({ revenue: 120.5, platformFees: 18.08, transactions: 3 }));
      expect(result.totals).toEqual(
        expect.objectContaining({ revenue: 120.5, platformFees: 18.08, newUsers: 4, contentUploads: 2, activeSubscriptions: 7 }),
      );
      expect(result.topCreators[0]).toEqual(
        expect.objectContaining({ id: 'c1', username: 'alice', revenue: 120.5, netRevenue: 102.42, subscribers: 5 }),
      );
    });

    it('rejects inverted periods', async () => {
      await expect(
        service.getAnalytics({ startDate: '2026-10-05T00:00:00Z', endDate: '2026-10-01T00:00:00Z' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getModerationStats', () => {
    it('computes handling time, breakdowns and actions', async () => {
      const now = Date.now();
      mockPrismaService.report.findMany
        // received
        .mockResolvedValueOnce([
          { createdAt: new Date(now - 3600_000), status: 'pending', reason: 'SPAM', reportedType: 'content' },
          { createdAt: new Date(now - 7200_000), status: 'resolved', reason: 'SPAM', reportedType: 'USER' },
        ])
        // handled
        .mockResolvedValueOnce([
          { createdAt: new Date(now - 7200_000), reviewedAt: new Date(now - 3600_000), status: 'resolved' },
        ]);
      mockPrismaService.report.count.mockResolvedValue(1);
      mockPrismaService.auditLog.findMany
        .mockResolvedValueOnce([
          { action: 'REPORT_RESOLVED', createdAt: new Date() },
          { action: 'USER_SUSPEND', createdAt: new Date() },
        ])
        .mockResolvedValueOnce([{ id: 'l1', action: 'REPORT_RESOLVED', userId: 'a1', createdAt: new Date() }]);
      mockPrismaService.user.findMany.mockResolvedValue([{ id: 'a1', username: 'admin' }]);

      const result = await service.getModerationStats({ days: 7 });

      expect(result.totals).toEqual(
        expect.objectContaining({ received: 2, handled: 1, pending: 1, resolutionRate: 50, avgHandlingHours: 1, todayActions: 2 }),
      );
      expect(result.byReason).toEqual([{ reason: 'SPAM', count: 2 }]);
      expect(result.byType).toEqual(expect.arrayContaining([{ type: 'CONTENT', count: 1 }, { type: 'USER', count: 1 }]));
      expect(result.overTime).toHaveLength(7);
      const today = result.actionsByDay[result.actionsByDay.length - 1];
      expect(today).toEqual(expect.objectContaining({ resolved: 1, sanctions: 1 }));
      expect(result.recentActions[0].actor).toEqual({ id: 'a1', username: 'admin' });
    });
  });
});
