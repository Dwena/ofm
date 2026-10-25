import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { PAID_SALE_STATUSES, SALE_TYPES } from './tax.constants';
import { AdjustmentRecord, AdjustmentType, SaleRecord } from './tax-reports';

const ADJUSTMENT_TYPES: AdjustmentType[] = ['REFUND', 'CHARGEBACK', 'CHARGEBACK_REVERSAL'];

const group = <T>(rows: { creatorId: string; record: T }[]) => {
  const map = new Map<string, T[]>();
  for (const { creatorId, record } of rows) {
    const list = map.get(creatorId);
    if (list) list.push(record);
    else map.set(creatorId, [record]);
  }
  return map;
};

/**
 * Reads the sales (transactions) and the refunds / chargebacks (creator
 * balance ledger) the tax documents are built from, grouped by creator.
 *
 * Volumes: one row per sale of the period. Fine for a monthly / yearly batch
 * at the current scale; switch to SQL aggregates if it ever becomes slow.
 */
@Injectable()
export class TaxDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** Paid sales of [start, end), by creator. Refunded / disputed sales were paid first: included. */
  async loadSales(start: Date, end: Date, creatorId?: string): Promise<Map<string, SaleRecord[]>> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        type: { in: [...SALE_TYPES] },
        status: { in: [...PAID_SALE_STATUSES] },
        toUserId: creatorId ?? { not: null },
        processedAt: { gte: start, lt: end },
      },
      select: { toUserId: true, type: true, amount: true, platformFee: true, netAmount: true, processedAt: true },
      orderBy: { processedAt: 'asc' },
    });
    return group(
      rows.map((row) => ({
        creatorId: row.toUserId!,
        record: {
          type: row.type,
          amount: Number(row.amount),
          platformFee: Number(row.platformFee),
          netAmount: Number(row.netAmount),
          date: row.processedAt!,
        },
      })),
    );
  }

  /** Creator shares taken back (or given back) in [start, end), by creator */
  async loadAdjustments(start: Date, end: Date, creatorId?: string): Promise<Map<string, AdjustmentRecord[]>> {
    const rows = await this.prisma.creatorBalanceEntry.findMany({
      where: {
        type: { in: ADJUSTMENT_TYPES },
        createdAt: { gte: start, lt: end },
        ...(creatorId ? { creatorId } : {}),
      },
      select: {
        creatorId: true,
        type: true,
        amount: true,
        createdAt: true,
        transaction: { select: { type: true, amount: true, platformFee: true, netAmount: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return group(
      rows.map((row) => ({
        creatorId: row.creatorId,
        record: {
          type: row.type as AdjustmentType,
          amount: Number(row.amount),
          date: row.createdAt,
          original: row.transaction
            ? {
                type: row.transaction.type,
                amount: Number(row.transaction.amount),
                platformFee: Number(row.transaction.platformFee),
                netAmount: Number(row.transaction.netAmount),
              }
            : null,
        },
      })),
    );
  }
}
