import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, Transaction } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { roundMoney } from '../common/utils/money';
import { CreatorBalanceService } from './creator-balance.service';
import { PAYMENT_PROVIDER, PaymentProvider, PaymentProviderError } from './providers/payment-provider';

const SALE_TYPES = ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] as const;

/** Part of a sale (price excl. VAT, VAT, fee, creator share) matching a refunded total */
export function splitRefund(sale: Pick<Transaction, 'amount' | 'vatAmount' | 'totalAmount' | 'platformFee' | 'netAmount'>, refundTotal: number) {
  const total = Number(sale.totalAmount) || Number(sale.amount);
  const ratio = total > 0 ? Math.min(1, refundTotal / total) : 1;
  const amount = roundMoney(Number(sale.amount) * ratio);
  const creatorShare = roundMoney(Number(sale.netAmount) * ratio);
  return {
    amount,
    vatAmount: roundMoney(refundTotal - amount),
    totalAmount: roundMoney(refundTotal),
    creatorShare,
    platformFee: roundMoney(amount - creatorShare),
  };
}

/**
 * Refunds and chargebacks of fan payments. The creator share of the refunded
 * part is taken back from the creator balance, the VAT refunded reduces the
 * VAT the platform owes (credit note), and access bought with the payment is
 * revoked when the whole payment is refunded.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private prisma: PrismaService,
    private balance: CreatorBalanceService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
  ) {}

  /**
   * Refund a payment (creator refunding one of their fans, or an admin)
   * @param amount Euros VAT included, the whole remaining amount when omitted
   */
  async refundTransaction(params: {
    requesterId: string;
    requesterRole: string;
    transactionId: string;
    amount?: number;
    reason?: string;
  }) {
    const sale = await this.prisma.transaction.findUnique({ where: { id: params.transactionId } });

    if (!sale || !SALE_TYPES.includes(sale.type as (typeof SALE_TYPES)[number])) {
      throw new NotFoundException('Transaction not found');
    }

    const isAdmin = params.requesterRole === 'ADMIN';
    if (!isAdmin && sale.toUserId !== params.requesterId) {
      throw new ForbiddenException('You can only refund transactions where you are the recipient');
    }

    if (sale.status === 'REFUNDED') {
      throw new BadRequestException('Transaction already refunded');
    }

    if (sale.status !== 'COMPLETED' && sale.status !== 'PARTIALLY_REFUNDED') {
      throw new BadRequestException('Can only refund completed transactions');
    }

    if (!sale.providerTransactionId || sale.provider !== this.provider.name) {
      throw new BadRequestException('This payment cannot be refunded automatically, contact support');
    }

    const remaining = roundMoney(Number(sale.totalAmount) - this.refundedTotal(sale));
    const amount = params.amount !== undefined ? roundMoney(params.amount) : remaining;

    if (!(amount > 0) || amount > remaining) {
      throw new BadRequestException(`Refund amount must be between 0.01 and ${remaining.toFixed(2)} €`);
    }

    let providerRefundId: string;
    try {
      ({ providerRefundId } = await this.provider.refund({
        providerTransactionId: sale.providerTransactionId,
        amount,
        full: amount === remaining && this.refundedTotal(sale) === 0,
        reason: params.reason,
      }));
    } catch (error) {
      const message = error instanceof PaymentProviderError ? error.message : (error as Error).message;
      this.logger.error(`Refund of ${sale.id} failed: ${message}`);
      throw new ServiceUnavailableException('Le remboursement a échoué, réessayez plus tard');
    }

    await this.recordRefund(sale, amount, providerRefundId, params.reason ?? null, params.requesterId);

    return {
      message: 'Refund processed successfully',
      refundAmount: amount,
      originalTransactionId: sale.id,
    };
  }

  /** Refund reported by the provider (made from its back-office, or confirming ours) */
  async handleProviderRefund(event: { providerRefundId: string; providerTransactionId: string; amount: number }) {
    const sale = await this.findSale(event.providerTransactionId);
    if (!sale) {
      this.logger.warn(`Refund ${event.providerRefundId} for unknown charge ${event.providerTransactionId}`);
      return false;
    }

    // Confirmation of a refund we already recorded when making it through the
    // provider's API: the provider reports it with its own id
    const recorded = await this.prisma.transaction.findMany({
      where: {
        type: 'REFUND',
        providerTransactionId: event.providerTransactionId,
        provider: this.provider.name,
        ...(event.amount > 0 && { totalAmount: roundMoney(event.amount) }),
      },
      orderBy: { createdAt: 'asc' },
    });
    const ours = (recorded ?? []).find((refund) => {
      const metadata = (refund.metadata as Record<string, unknown> | null) ?? {};
      return typeof metadata.initiatedBy === 'string' && metadata.providerConfirmed !== true;
    });
    if (ours) {
      await this.prisma.transaction.update({
        where: { id: ours.id },
        data: {
          metadata: {
            ...((ours.metadata as Record<string, unknown> | null) ?? {}),
            providerConfirmed: true,
            providerRefundEventId: event.providerRefundId,
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    }

    const remaining = roundMoney(Number(sale.totalAmount) - this.refundedTotal(sale));
    const amount = event.amount > 0 ? Math.min(roundMoney(event.amount), remaining) : remaining;
    if (amount <= 0) return false;

    await this.recordRefund(sale, amount, event.providerRefundId, 'Remboursement via le prestataire de paiement', null);
    return true;
  }

  /**
   * Record a refund once (idempotent on the provider refund id): REFUND
   * transaction, original status, creator balance, revoked access, notifications
   */
  async recordRefund(sale: Transaction, refundTotal: number, providerRefundId: string, reason: string | null, initiatedBy: string | null) {
    const split = splitRefund(sale, refundTotal);
    const fullyRefunded = roundMoney(this.refundedTotal(sale) + refundTotal) >= roundMoney(Number(sale.totalAmount));
    const metadata = (sale.metadata as Record<string, unknown> | null) ?? {};

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.transaction.create({
          data: {
            fromUserId: sale.toUserId ?? sale.fromUserId,
            toUserId: sale.fromUserId,
            type: 'REFUND',
            status: 'COMPLETED',
            amount: split.amount,
            vatRate: sale.vatRate,
            vatAmount: split.vatAmount,
            totalAmount: split.totalAmount,
            taxCountry: sale.taxCountry,
            platformFee: split.platformFee,
            netAmount: split.creatorShare,
            currency: sale.currency,
            provider: sale.provider,
            providerPaymentId: providerRefundId,
            providerTransactionId: sale.providerTransactionId,
            subscriptionId: sale.subscriptionId,
            contentId: sale.contentId,
            processedAt: new Date(),
            metadata: {
              originalTransactionId: sale.id,
              reason,
              initiatedBy,
              refundType: fullyRefunded ? 'full' : 'partial',
            },
          },
        });

        await tx.transaction.update({
          where: { id: sale.id },
          data: {
            status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            metadata: {
              ...metadata,
              refundedTotal: roundMoney(this.refundedTotal(sale) + refundTotal),
              refundedAt: new Date().toISOString(),
              refundReason: reason,
            } as Prisma.InputJsonValue,
          },
        });

        if (sale.toUserId) {
          await this.balance.debitSale(tx, {
            creatorId: sale.toUserId,
            transactionId: sale.id,
            amount: split.creatorShare,
            currency: sale.currency,
            type: 'REFUND',
            description: 'Remboursement',
          });
          await tx.creatorProfile.updateMany({
            where: { userId: sale.toUserId },
            data: { totalEarnings: { decrement: split.creatorShare } },
          });
        }

        if (fullyRefunded) {
          await this.revokeAccess(tx, sale, metadata);
        }
      });
    } catch (error) {
      // Same refund reported twice (our call, then the provider's webhook)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }
      throw error;
    }

    this.logger.log(`Refund recorded for transaction ${sale.id}: ${refundTotal.toFixed(2)} € (${providerRefundId})`);

    await this.notify(sale.fromUserId, 'Remboursement effectué', `Un remboursement de ${refundTotal.toFixed(2)}€ a été effectué`, 'REFUND_PROCESSED');
    if (sale.toUserId) {
      await this.notify(
        sale.toUserId,
        'Remboursement émis',
        `Un paiement a été remboursé : ${split.creatorShare.toFixed(2)}€ ont été retirés de votre solde`,
        'REFUND_ISSUED',
      );
    }
  }

  /**
   * Chargeback: the fan's bank took the money back. The creator share is
   * taken back, access revoked, and admins are warned (repeated chargebacks
   * may justify suspending the fan).
   */
  async handleChargeback(event: {
    providerDisputeId: string;
    providerTransactionId: string;
    amount: number;
    currency: string;
    reason: string;
  }) {
    const sale = await this.findSale(event.providerTransactionId);
    if (!sale) {
      this.logger.warn(`Chargeback ${event.providerDisputeId} for unknown charge ${event.providerTransactionId}`);
      return false;
    }

    const disputed = event.amount > 0 ? Math.min(event.amount, Number(sale.totalAmount)) : Number(sale.totalAmount);
    const split = splitRefund(sale, disputed);
    const metadata = (sale.metadata as Record<string, unknown> | null) ?? {};

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.dispute.create({
          data: {
            providerDisputeId: event.providerDisputeId,
            transactionId: sale.id,
            amount: roundMoney(disputed),
            currency: event.currency,
            reason: event.reason,
            status: 'lost',
          },
        });

        await tx.transaction.update({
          where: { id: sale.id },
          data: {
            status: 'DISPUTED',
            metadata: {
              ...metadata,
              disputeId: event.providerDisputeId,
              disputeReason: event.reason,
              disputedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });

        if (sale.toUserId) {
          await this.balance.debitSale(tx, {
            creatorId: sale.toUserId,
            transactionId: sale.id,
            amount: split.creatorShare,
            currency: sale.currency,
            type: 'CHARGEBACK',
            description: 'Contestation bancaire',
          });
          await tx.creatorProfile.updateMany({
            where: { userId: sale.toUserId },
            data: { totalEarnings: { decrement: split.creatorShare } },
          });
        }

        await this.revokeAccess(tx, sale, metadata);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }

    this.logger.warn(`Chargeback ${event.providerDisputeId} on transaction ${sale.id} (${disputed.toFixed(2)} €)`);

    if (sale.toUserId) {
      await this.notify(
        sale.toUserId,
        'Contestation bancaire',
        `Un fan a contesté un paiement auprès de sa banque : ${split.creatorShare.toFixed(2)}€ ont été retirés de votre solde`,
        'DISPUTE_CREATED',
      );
    }

    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', deletedAt: null }, select: { id: true } });
    for (const admin of admins) {
      await this.notify(
        admin.id,
        'Chargeback reçu',
        `Contestation de ${disputed.toFixed(2)}€ sur la transaction ${sale.id} (fan ${sale.fromUserId})`,
        'DISPUTE_CREATED',
      );
    }
    return true;
  }

  /** Chargeback reversed in favour of the platform */
  async handleChargebackReversed(event: { providerDisputeId: string; providerTransactionId: string }) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { providerDisputeId: event.providerDisputeId },
      include: { transaction: true },
    });
    if (!dispute || dispute.status === 'won') return false;

    const sale = dispute.transaction;
    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({ where: { id: dispute.id }, data: { status: 'won', closedAt: new Date() } });
      await tx.transaction.update({ where: { id: sale.id }, data: { status: 'COMPLETED' } });
      if (sale.toUserId) {
        const entry = await this.balance.reverseChargeback(tx, {
          creatorId: sale.toUserId,
          transactionId: sale.id,
          currency: sale.currency,
        });
        if (entry) {
          await tx.creatorProfile.updateMany({
            where: { userId: sale.toUserId },
            data: { totalEarnings: { increment: Number(entry.amount) } },
          });
        }
      }
    });

    if (sale.toUserId) {
      await this.notify(sale.toUserId, 'Litige gagné', 'La contestation a été résolue en votre faveur, le montant est revenu sur votre solde', 'DISPUTE_WON');
    }
    return true;
  }

  private refundedTotal(sale: Transaction) {
    const metadata = (sale.metadata as Record<string, unknown> | null) ?? {};
    return Number(metadata.refundedTotal ?? 0) || 0;
  }

  private async findSale(providerTransactionId: string) {
    return this.prisma.transaction.findFirst({
      where: { providerTransactionId, provider: this.provider.name, type: { in: [...SALE_TYPES] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Remove what the payment gave access to */
  private async revokeAccess(tx: Prisma.TransactionClient, sale: Transaction, metadata: Record<string, unknown>) {
    const kind = metadata.kind;

    if (kind === 'content_unlock' && sale.contentId) {
      await tx.contentUnlock.deleteMany({ where: { contentId: sale.contentId, userId: sale.fromUserId } });
    }

    if (kind === 'message_unlock' && typeof metadata.messageId === 'string') {
      await tx.message.updateMany({
        where: { id: metadata.messageId, receiverId: sale.fromUserId },
        data: { isPurchased: false },
      });
    }

    // Stream access is checked against a COMPLETED transaction: nothing to remove

    if (sale.type === 'SUBSCRIPTION' && sale.subscriptionId) {
      // Only the period this payment paid for: end the subscription now
      await tx.subscription.updateMany({
        where: { id: sale.subscriptionId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelAtPeriodEnd: false, currentPeriodEnd: new Date() },
      });
    }
  }

  private async notify(userId: string, title: string, message: string, kind: string) {
    try {
      await this.prisma.notification.create({
        data: { userId, type: 'SYSTEM', title, message, metadata: { kind } },
      });
    } catch (error) {
      this.logger.error(`Failed to create notification: ${(error as Error).message}`);
    }
  }
}
