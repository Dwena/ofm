import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { AnalyticsInterval, GetAnalyticsDto, GetModerationStatsDto, ReportStatus } from './dto/admin.dto';
import { normalizeReportStatus, reportStatusValues } from './report-status.util';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BUCKETS = 400;

/** Transaction types that count as platform revenue (payouts/refunds excluded) */
const REVENUE_TYPES = ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] as const;

/** Audit-log action prefixes written by admin & moderation actions */
const MODERATION_ACTION_PREFIXES = ['REPORT_', 'USER_', 'CONTENT_'];

type ModerationActionCategory = 'resolved' | 'rejected' | 'sanctions' | 'contentRemoved' | 'other';

function categorizeAction(action: string): ModerationActionCategory {
  if (action === 'REPORT_RESOLVED') return 'resolved';
  if (action === 'REPORT_REJECTED') return 'rejected';
  if (action === 'CONTENT_REMOVED') return 'contentRemoved';
  if (
    ['USER_SUSPEND', 'USER_BAN', 'USER_WARN', 'USER_DELETED', 'USER_BANNED', 'USER_SUSPENDED'].includes(action)
  ) {
    return 'sanctions';
  }
  return 'other';
}

/**
 * Truncate a date to the start of its bucket, in UTC, like Postgres date_trunc
 * (weeks start on Monday).
 */
export function truncateDate(date: Date, interval: AnalyticsInterval): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (interval === AnalyticsInterval.WEEK) {
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - day);
  } else if (interval === AnalyticsInterval.MONTH) {
    d.setUTCDate(1);
  }
  return d;
}

function nextBucket(date: Date, interval: AnalyticsInterval): Date {
  const d = new Date(date);
  if (interval === AnalyticsInterval.MONTH) d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + (interval === AnalyticsInterval.WEEK ? 7 : 1));
  return d;
}

export function bucketKey(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** Every bucket key between start and end (inclusive) */
export function buildBuckets(start: Date, end: Date, interval: AnalyticsInterval): string[] {
  const keys: string[] = [];
  for (let d = truncateDate(start, interval); d <= end && keys.length < MAX_BUCKETS; d = nextBucket(d, interval)) {
    keys.push(bucketKey(d));
  }
  return keys;
}

const toNumber = (value: unknown) => Number(value ?? 0) || 0;
const round2 = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class AdminAnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Platform analytics over a period, grouped by day / week / month.
   * Money is returned in euros (as stored in the database).
   */
  async getAnalytics(dto: GetAnalyticsDto) {
    const interval = dto.interval ?? AnalyticsInterval.DAY;
    const end = dto.endDate ? new Date(dto.endDate) : new Date();
    const start = dto.startDate ? new Date(dto.startDate) : new Date(end.getTime() - 29 * DAY_MS);

    if (start > end) {
      throw new BadRequestException('startDate must be before endDate');
    }
    const keys = buildBuckets(start, end, interval);
    if (keys.length >= MAX_BUCKETS) {
      throw new BadRequestException('Période trop longue pour cet intervalle');
    }

    // interval comes from a validated enum, safe to inline
    const unit = Prisma.raw(`'${interval}'`);
    const revenueTypes = Prisma.join(REVENUE_TYPES.map((t) => Prisma.raw(`'${t}'`)));
    const createdRange = Prisma.sql`"createdAt" >= ${start} AND "createdAt" <= ${end}`;

    const [
      revenueRows,
      userRows,
      contentRows,
      subscriptionRows,
      cancellationRows,
      revenueByType,
      topCreatorRows,
      activeSubscriptions,
      totalUsers,
      totalCreators,
    ] = await Promise.all([
      this.prisma.$queryRaw<{ bucket: Date; revenue: number; fees: number; count: number }[]>(Prisma.sql`
        SELECT date_trunc(${unit}, "createdAt") AS bucket,
               COALESCE(SUM("amount"), 0)::float8 AS revenue,
               COALESCE(SUM("platformFee"), 0)::float8 AS fees,
               COUNT(*)::int AS count
        FROM "Transaction"
        WHERE "status" = 'COMPLETED' AND "type" IN (${revenueTypes}) AND ${createdRange}
        GROUP BY 1 ORDER BY 1`),
      this.prisma.$queryRaw<{ bucket: Date; users: number; creators: number }[]>(Prisma.sql`
        SELECT date_trunc(${unit}, "createdAt") AS bucket,
               COUNT(*)::int AS users,
               (COUNT(*) FILTER (WHERE "role" = 'CREATOR'))::int AS creators
        FROM "User"
        WHERE "deletedAt" IS NULL AND ${createdRange}
        GROUP BY 1 ORDER BY 1`),
      this.prisma.$queryRaw<{ bucket: Date; uploads: number }[]>(Prisma.sql`
        SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::int AS uploads
        FROM "Content"
        WHERE ${createdRange}
        GROUP BY 1 ORDER BY 1`),
      this.prisma.$queryRaw<{ bucket: Date; count: number }[]>(Prisma.sql`
        SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::int AS count
        FROM "Subscription"
        WHERE ${createdRange}
        GROUP BY 1 ORDER BY 1`),
      this.prisma.$queryRaw<{ bucket: Date; count: number }[]>(Prisma.sql`
        SELECT date_trunc(${unit}, "cancelledAt") AS bucket, COUNT(*)::int AS count
        FROM "Subscription"
        WHERE "cancelledAt" >= ${start} AND "cancelledAt" <= ${end}
        GROUP BY 1 ORDER BY 1`),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: { status: 'COMPLETED', type: { in: [...REVENUE_TYPES] }, createdAt: { gte: start, lte: end } },
        _sum: { amount: true, platformFee: true },
        _count: { id: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['toUserId'],
        where: {
          status: 'COMPLETED',
          type: { in: [...REVENUE_TYPES] },
          toUserId: { not: null },
          createdAt: { gte: start, lte: end },
        },
        _sum: { amount: true, platformFee: true, netAmount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10,
      }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { role: 'CREATOR', deletedAt: null } }),
    ]);

    const series = new Map(
      keys.map((date) => [
        date,
        {
          date,
          revenue: 0,
          platformFees: 0,
          transactions: 0,
          newUsers: 0,
          newCreators: 0,
          contentUploads: 0,
          newSubscriptions: 0,
          cancelledSubscriptions: 0,
        },
      ]),
    );
    const at = (bucket: Date) => series.get(bucketKey(bucket));

    for (const row of revenueRows) {
      const point = at(row.bucket);
      if (!point) continue;
      point.revenue = round2(toNumber(row.revenue));
      point.platformFees = round2(toNumber(row.fees));
      point.transactions = toNumber(row.count);
    }
    for (const row of userRows) {
      const point = at(row.bucket);
      if (!point) continue;
      point.newUsers = toNumber(row.users);
      point.newCreators = toNumber(row.creators);
    }
    for (const row of contentRows) {
      const point = at(row.bucket);
      if (point) point.contentUploads = toNumber(row.uploads);
    }
    for (const row of subscriptionRows) {
      const point = at(row.bucket);
      if (point) point.newSubscriptions = toNumber(row.count);
    }
    for (const row of cancellationRows) {
      const point = at(row.bucket);
      if (point) point.cancelledSubscriptions = toNumber(row.count);
    }

    const points = [...series.values()];
    const sum = (field: keyof (typeof points)[number]) =>
      points.reduce((acc, point) => acc + (point[field] as number), 0);

    // Top creators by revenue generated in the period
    const creatorIds = topCreatorRows.map((row: any) => row.toUserId).filter(Boolean) as string[];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            creatorProfile: { select: { totalSubscribers: true, totalContent: true } },
          },
        })
      : [];
    const creatorById = new Map(creators.map((c: any) => [c.id, c]));

    return {
      period: { start: start.toISOString(), end: end.toISOString(), interval },
      totals: {
        revenue: round2(sum('revenue')),
        platformFees: round2(sum('platformFees')),
        transactions: sum('transactions'),
        newUsers: sum('newUsers'),
        newCreators: sum('newCreators'),
        contentUploads: sum('contentUploads'),
        newSubscriptions: sum('newSubscriptions'),
        cancelledSubscriptions: sum('cancelledSubscriptions'),
        activeSubscriptions,
        totalUsers,
        totalCreators,
      },
      series: points,
      revenueByType: revenueByType.map((row: any) => ({
        type: row.type,
        amount: round2(toNumber(row._sum.amount)),
        platformFees: round2(toNumber(row._sum.platformFee)),
        count: row._count.id,
      })),
      topCreators: topCreatorRows.map((row: any) => {
        const creator: any = creatorById.get(row.toUserId);
        return {
          id: row.toUserId,
          username: creator?.username ?? null,
          displayName: creator?.displayName ?? null,
          avatar: creator?.avatar ?? null,
          subscribers: creator?.creatorProfile?.totalSubscribers ?? 0,
          revenue: round2(toNumber(row._sum.amount)),
          platformFees: round2(toNumber(row._sum.platformFee)),
          netRevenue: round2(toNumber(row._sum.netAmount)),
          transactions: row._count.id,
        };
      }),
    };
  }

  /**
   * Moderation statistics over the last `days` days: reports received/handled per day,
   * breakdown by status/reason/type, handling time and moderation actions (from the audit log).
   */
  async getModerationStats(dto: GetModerationStatsDto) {
    const days = dto.days ?? 30;
    const now = new Date();
    const start = truncateDate(new Date(now.getTime() - (days - 1) * DAY_MS), AnalyticsInterval.DAY);
    const startOfToday = truncateDate(now, AnalyticsInterval.DAY);

    const actionFilter = {
      OR: MODERATION_ACTION_PREFIXES.map((prefix) => ({ action: { startsWith: prefix } })),
    };

    const [received, handled, pendingNow, logs, recentLogs] = await Promise.all([
      this.prisma.report.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true, status: true, reason: true, reportedType: true },
      }),
      this.prisma.report.findMany({
        where: {
          reviewedAt: { gte: start },
          status: {
            in: [...reportStatusValues(ReportStatus.RESOLVED), ...reportStatusValues(ReportStatus.REJECTED)],
          },
        },
        select: { createdAt: true, reviewedAt: true, status: true },
      }),
      this.prisma.report.count({ where: { status: { in: reportStatusValues(ReportStatus.PENDING) } } }),
      this.prisma.auditLog.findMany({
        where: { createdAt: { gte: start }, ...actionFilter },
        select: { action: true, createdAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: actionFilter,
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const keys = buildBuckets(start, now, AnalyticsInterval.DAY);
    const overTime = new Map(keys.map((date) => [date, { date, received: 0, handled: 0 }]));
    const actionsByDay = new Map(
      keys.map((date) => [date, { date, resolved: 0, rejected: 0, sanctions: 0, contentRemoved: 0, other: 0 }]),
    );

    const byStatus: Record<string, number> = {
      [ReportStatus.PENDING]: 0,
      [ReportStatus.REVIEWING]: 0,
      [ReportStatus.RESOLVED]: 0,
      [ReportStatus.REJECTED]: 0,
    };
    const byReason = new Map<string, number>();
    const byType = new Map<string, number>();

    for (const report of received) {
      const status = normalizeReportStatus(report.status);
      byStatus[status] = (byStatus[status] || 0) + 1;
      byReason.set(report.reason, (byReason.get(report.reason) || 0) + 1);
      const type = report.reportedType?.toUpperCase();
      byType.set(type, (byType.get(type) || 0) + 1);
      const point = overTime.get(bucketKey(report.createdAt));
      if (point) point.received++;
    }

    const handlingHours: number[] = [];
    for (const report of handled) {
      if (!report.reviewedAt) continue;
      handlingHours.push((new Date(report.reviewedAt).getTime() - new Date(report.createdAt).getTime()) / 3_600_000);
      const point = overTime.get(bucketKey(report.reviewedAt));
      if (point) point.handled++;
    }
    handlingHours.sort((a, b) => a - b);
    const avgHandlingHours = handlingHours.length
      ? Math.round((handlingHours.reduce((a, b) => a + b, 0) / handlingHours.length) * 10) / 10
      : null;
    const medianHandlingHours = handlingHours.length
      ? Math.round(handlingHours[Math.floor(handlingHours.length / 2)] * 10) / 10
      : null;

    const actionCounts = new Map<string, number>();
    let todayActions = 0;
    for (const log of logs) {
      actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
      if (log.createdAt >= startOfToday) todayActions++;
      const point = actionsByDay.get(bucketKey(log.createdAt));
      if (point) point[categorizeAction(log.action)]++;
    }

    // AuditLog has no relation to User: load actors separately
    const actorIds = [...new Set(recentLogs.map((l: any) => l.userId).filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, username: true, displayName: true, avatar: true },
        })
      : [];
    const actorById = new Map(actors.map((a: any) => [a.id, a]));

    const decided = byStatus[ReportStatus.RESOLVED] + byStatus[ReportStatus.REJECTED];
    const sortedEntries = (map: Map<string, number>, key: string) =>
      [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ [key]: name, count }));

    return {
      period: { start: start.toISOString(), end: now.toISOString(), days },
      totals: {
        received: received.length,
        handled: handled.length,
        pending: pendingNow,
        resolutionRate: received.length ? Math.round((decided / received.length) * 100) : 0,
        avgHandlingHours,
        medianHandlingHours,
        actions: logs.length,
        todayActions,
      },
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      byReason: sortedEntries(byReason, 'reason'),
      byType: sortedEntries(byType, 'type'),
      overTime: [...overTime.values()],
      actionsByDay: [...actionsByDay.values()],
      actionsByType: sortedEntries(actionCounts, 'action'),
      recentActions: recentLogs.map((log: any) => ({
        id: log.id,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        metadata: log.metadata,
        createdAt: log.createdAt,
        actor: log.userId ? actorById.get(log.userId) || null : null,
      })),
    };
  }
}
