import { Injectable } from '@nestjs/common';
import { BalanceEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { roundMoney } from '../common/utils/money';

type Client = Prisma.TransactionClient | PrismaService;

export interface CreatorBalance {
  /** Can be paid out now (euros) */
  available: number;
  /** Earnings still on hold (euros) */
  pending: number;
  /** available + pending */
  total: number;
}

/**
 * Ledger of what the platform owes each creator (CreatorBalanceEntry).
 *
 * The fan pays the platform; the creator share of each sale is credited here
 * and held for `earningsHoldDays` (refunds and chargebacks of the first days
 * are taken back from it), then becomes available for payout. Payouts and
 * reversals are debits. Every movement is an entry: the balance is their sum.
 */
@Injectable()
export class CreatorBalanceService {
  constructor(private prisma: PrismaService) {}

  /**
   * Serialize balance changes of one creator inside a database transaction
   * (payout requests must not spend the same balance twice)
   */
  async lock(tx: Prisma.TransactionClient, creatorId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`creator-balance:${creatorId}`}))`;
  }

  /** Credit the creator share of a completed sale, available after the hold period */
  async creditEarning(
    tx: Client,
    params: { creatorId: string; transactionId: string; amount: number; currency: string; holdDays: number; description?: string },
  ) {
    const availableAt = new Date(Date.now() + params.holdDays * 24 * 60 * 60 * 1000);
    return tx.creatorBalanceEntry.create({
      data: {
        creatorId: params.creatorId,
        type: 'EARNING',
        amount: roundMoney(params.amount),
        currency: params.currency,
        transactionId: params.transactionId,
        availableAt,
        description: params.description,
      },
    });
  }

  /**
   * Take back (part of) the creator share of a sale: refund or chargeback.
   * The debit lands when the earning itself becomes available, so the
   * available / pending split stays consistent.
   */
  async debitSale(
    tx: Client,
    params: {
      creatorId: string;
      transactionId: string;
      /** Positive amount taken back (euros) */
      amount: number;
      currency: string;
      type: Extract<BalanceEntryType, 'REFUND' | 'CHARGEBACK'>;
      description?: string;
    },
  ) {
    const earning = await tx.creatorBalanceEntry.findFirst({
      where: { transactionId: params.transactionId, type: 'EARNING' },
      select: { availableAt: true },
    });
    const now = new Date();
    const availableAt = earning && earning.availableAt > now ? earning.availableAt : now;

    return tx.creatorBalanceEntry.create({
      data: {
        creatorId: params.creatorId,
        type: params.type,
        amount: -roundMoney(params.amount),
        currency: params.currency,
        transactionId: params.transactionId,
        availableAt,
        description: params.description,
      },
    });
  }

  /** Chargeback won: give back what the chargeback took */
  async reverseChargeback(tx: Client, params: { creatorId: string; transactionId: string; currency: string }) {
    const chargebacks = await tx.creatorBalanceEntry.aggregate({
      where: { transactionId: params.transactionId, type: { in: ['CHARGEBACK', 'CHARGEBACK_REVERSAL'] } },
      _sum: { amount: true },
    });
    const outstanding = -Number(chargebacks._sum.amount ?? 0);
    if (outstanding <= 0) return null;

    return tx.creatorBalanceEntry.create({
      data: {
        creatorId: params.creatorId,
        type: 'CHARGEBACK_REVERSAL',
        amount: roundMoney(outstanding),
        currency: params.currency,
        transactionId: params.transactionId,
        description: 'Litige gagné',
      },
    });
  }

  async debitPayout(tx: Client, params: { creatorId: string; payoutId: string; amount: number; currency: string }) {
    return tx.creatorBalanceEntry.create({
      data: {
        creatorId: params.creatorId,
        type: 'PAYOUT',
        amount: -roundMoney(params.amount),
        currency: params.currency,
        payoutId: params.payoutId,
        description: 'Virement',
      },
    });
  }

  /** Failed or cancelled transfer: the amount goes back to the balance */
  async reversePayout(tx: Client, params: { creatorId: string; payoutId: string; amount: number; currency: string; reason: string }) {
    return tx.creatorBalanceEntry.create({
      data: {
        creatorId: params.creatorId,
        type: 'PAYOUT_REVERSAL',
        amount: roundMoney(params.amount),
        currency: params.currency,
        payoutId: params.payoutId,
        description: params.reason,
      },
    });
  }

  async adjust(tx: Client, params: { creatorId: string; amount: number; description: string; adminId: string }) {
    return tx.creatorBalanceEntry.create({
      data: {
        creatorId: params.creatorId,
        type: 'ADJUSTMENT',
        amount: roundMoney(params.amount),
        description: params.description,
        createdBy: params.adminId,
      },
    });
  }

  async getBalance(creatorId: string, client: Client = this.prisma): Promise<CreatorBalance> {
    const now = new Date();
    const [available, pending] = await Promise.all([
      client.creatorBalanceEntry.aggregate({
        where: { creatorId, availableAt: { lte: now } },
        _sum: { amount: true },
      }),
      client.creatorBalanceEntry.aggregate({
        where: { creatorId, availableAt: { gt: now } },
        _sum: { amount: true },
      }),
    ]);

    const availableAmount = roundMoney(Number(available._sum.amount ?? 0));
    const pendingAmount = roundMoney(Number(pending._sum.amount ?? 0));
    return { available: availableAmount, pending: pendingAmount, total: roundMoney(availableAmount + pendingAmount) };
  }
}
