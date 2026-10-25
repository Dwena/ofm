import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Transaction, TransactionType } from '@prisma/client';
import { Subject } from 'rxjs';
import { PrismaService } from '../common/database/prisma.service';
import { roundMoney } from '../common/utils/money';
import { computeCharge, normalizeCountry } from '../common/utils/vat';
import { SettingsService } from '../settings/settings.service';
import { CreatorBalanceService } from './creator-balance.service';
import {
  CardDetails,
  PAYMENT_PROVIDER,
  PaymentProvider,
  PaymentProviderError,
  SavedCardChargeResult,
} from './providers/payment-provider';

/** What a payment pays for (stored in the transaction metadata) */
export type PaymentKind = 'content_unlock' | 'stream_access' | 'tip' | 'message_unlock' | 'subscription';

/** Kept for the modules that only sell one-off items */
export type OneTimePaymentKind = Exclude<PaymentKind, 'subscription'>;

/** Options of a purchase chosen by the fan at checkout, plus request context */
export interface PurchaseOptions {
  paymentCardId?: string;
  billingCountry?: string;
  withdrawalWaiver?: boolean;
  ipCountry?: string | null;
  clientIp?: string | null;
}

export interface StartPaymentParams {
  payerId: string;
  creatorId: string;
  kind: PaymentKind;
  /** Price excluding VAT (euros); VAT of the fan's country is added on top */
  amount: number;
  /** Content id (PPV content) or stream id (PPV live); PPV messages use metadata.messageId */
  contentId?: string;
  subscriptionId?: string;
  /** Saved card to charge now; otherwise the fan is sent to the provider's payment page */
  paymentCardId?: string;
  /** Billing country declared at checkout (ISO alpha-2), saved on the fan's account */
  billingCountry?: string;
  /** The fan asked for immediate access and waived the withdrawal right */
  withdrawalWaiver?: boolean;
  description: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  /** merchant: renewal charged by the platform (no fan in front of the screen) */
  initiator?: 'customer' | 'merchant';
  /** Web path the fan comes back to after the provider's payment page */
  returnPath?: string;
  /** Country of the fan's IP (CDN header), a VAT location evidence */
  ipCountry?: string | null;
  clientIp?: string | null;
}

export type PaymentFlowStatus = 'completed' | 'processing' | 'requires_redirect' | 'failed';

export interface PaymentFlowResult {
  status: PaymentFlowStatus;
  /** True once the payment succeeded and access / earnings were granted */
  completed: boolean;
  transactionId: string;
  /** Provider page to send the fan to (new card, or bank authentication) */
  redirectUrl: string | null;
  /** Price excluding VAT, VAT and total charged (euros) */
  amount: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  failureReason: string | null;
}

export interface TipCompletedEvent {
  transactionId: string;
  streamId: string | null;
  creatorId: string;
  fromUser: { id: string; username: string; displayName: string | null; avatar: string | null };
  /** Amount excluding VAT, in euros (what the creator set / the fan chose) */
  amount: number;
  message: string | null;
  /** Tip menu item the fan chose (live tips) */
  menuItemId?: string | null;
  menuItemLabel?: string | null;
  completedAt: Date;
}

/** Hooks of another module on the payments of one kind (subscriptions) */
export interface PaymentKindHandler {
  /** Inside the database transaction completing the payment */
  onCompleted(tx: Prisma.TransactionClient, transaction: Transaction, metadata: Record<string, unknown>): Promise<void>;
  /** After commit (notifications) */
  afterCompleted?(transaction: Transaction, metadata: Record<string, unknown>): Promise<void>;
  onFailed?(transaction: Transaction, metadata: Record<string, unknown>, reason: string): Promise<void>;
}

/**
 * Transaction statuses a successful payment may complete: a failed attempt can
 * be retried, and a checkout cancelled as abandoned after 24 h may still be
 * confirmed late by the provider (the fan paid: access is granted)
 */
const COMPLETABLE_STATUSES = ['PENDING', 'PROCESSING', 'FAILED', 'CANCELLED'] as const;

const TRANSACTION_TYPE: Record<PaymentKind, TransactionType> = {
  content_unlock: 'PPV_UNLOCK',
  stream_access: 'PPV_UNLOCK',
  tip: 'TIP',
  message_unlock: 'PPV_UNLOCK',
  subscription: 'SUBSCRIPTION',
};

/** Digital content supplied right away: the fan must waive the 14-day withdrawal right */
const REQUIRES_WITHDRAWAL_WAIVER: Record<PaymentKind, boolean> = {
  content_unlock: true,
  stream_access: true,
  message_unlock: true,
  subscription: true,
  tip: false,
};

/**
 * Fan payments (subscriptions, PPV content / messages / lives, tips).
 *
 * Flow: a PENDING transaction is created with the price, the VAT of the fan's
 * country and the split (platform fee / creator share). A saved card is
 * charged right away; otherwise the fan pays on the provider's page and the
 * webhook completes the payment. Completion is an atomic PENDING -> COMPLETED
 * transition (webhook, saved card charge and simulator never credit twice)
 * that grants access and credits the creator balance.
 */
@Injectable()
export class PaymentFlowService {
  private readonly logger = new Logger(PaymentFlowService.name);
  private readonly handlers = new Map<PaymentKind, PaymentKindHandler>();

  /** Emits once per tip, when it is paid */
  readonly tipCompleted$ = new Subject<TipCompletedEvent>();

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private balance: CreatorBalanceService,
    private configService: ConfigService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
  ) {}

  registerHandler(kind: PaymentKind, handler: PaymentKindHandler) {
    this.handlers.set(kind, handler);
  }

  get providerName() {
    return this.provider.name;
  }

  isConfigured() {
    return this.provider.isConfigured();
  }

  /**
   * A creator can sell once their identity is verified (KYC) and their account is active
   */
  static canSell(creator: { role: string; kycStatus: string; status: string; deletedAt?: Date | null } | null) {
    return !!creator && creator.role === 'CREATOR' && creator.kycStatus === 'VERIFIED' && creator.status === 'ACTIVE' && !creator.deletedAt;
  }

  /**
   * Create the pending transaction and charge the saved card, or open the provider's payment page
   */
  async startPayment(params: StartPaymentParams): Promise<PaymentFlowResult> {
    const price = roundMoney(params.amount);
    if (!(price > 0)) {
      throw new BadRequestException('Invalid amount');
    }

    if (!this.provider.isConfigured()) {
      throw new ServiceUnavailableException('Payments are not configured on this platform');
    }

    const initiator = params.initiator ?? 'customer';
    if (initiator === 'customer' && REQUIRES_WITHDRAWAL_WAIVER[params.kind] && !params.withdrawalWaiver) {
      throw new BadRequestException({
        code: 'WITHDRAWAL_WAIVER_REQUIRED',
        message:
          "Pour accéder immédiatement au contenu, vous devez demander l'exécution immédiate et renoncer à votre droit de rétractation",
      });
    }

    const [payer, creator] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: params.payerId } }),
      this.prisma.user.findUnique({
        where: { id: params.creatorId },
        select: { id: true, role: true, kycStatus: true, status: true, deletedAt: true },
      }),
    ]);

    if (!payer) {
      throw new NotFoundException('User not found');
    }

    if (!PaymentFlowService.canSell(creator)) {
      throw new BadRequestException({
        code: 'CREATOR_NOT_READY',
        message: 'Ce créateur ne peut pas encore recevoir de paiements',
      });
    }

    const billingCountry = normalizeCountry(params.billingCountry) ?? normalizeCountry(payer.billingCountry);
    if (!billingCountry) {
      throw new BadRequestException({
        code: 'BILLING_COUNTRY_REQUIRED',
        message: 'Indiquez votre pays de résidence pour calculer la TVA',
      });
    }
    if (billingCountry !== payer.billingCountry) {
      await this.prisma.user.update({ where: { id: payer.id }, data: { billingCountry } });
    }

    const card = params.paymentCardId ? await this.getOwnCard(payer.id, params.paymentCardId) : null;
    const charge = computeCharge(price, await this.settingsService.getPlatformFeePercentage(), billingCountry);
    const metadata = Object.fromEntries(
      Object.entries(params.metadata ?? {}).filter(([, value]) => value !== undefined),
    );

    const transaction = await this.prisma.transaction.create({
      data: {
        fromUserId: params.payerId,
        toUserId: params.creatorId,
        type: TRANSACTION_TYPE[params.kind],
        status: 'PENDING',
        amount: charge.amount,
        platformFee: charge.platformFee,
        netAmount: charge.netAmount,
        vatRate: charge.vatRate,
        vatAmount: charge.vatAmount,
        totalAmount: charge.totalAmount,
        currency: 'EUR',
        taxCountry: charge.taxCountry,
        taxEvidence: {
          declaredCountry: billingCountry,
          ipCountry: normalizeCountry(params.ipCountry),
          cardCountry: normalizeCountry(card?.country),
        },
        provider: this.provider.name,
        paymentCardId: card?.id,
        withdrawalWaivedAt: params.withdrawalWaiver ? new Date() : null,
        contentId: params.contentId,
        subscriptionId: params.subscriptionId,
        metadata: { ...metadata, kind: params.kind, description: params.description, initiator },
      },
    });

    try {
      if (card) {
        const result = await this.provider.chargeSavedCard({
          reference: transaction.id,
          cardToken: card.providerToken,
          amount: charge.totalAmount,
          currency: 'EUR',
          description: params.description,
          initiator,
          customer: { id: payer.id, email: payer.email, ip: params.clientIp },
        });
        return await this.applyChargeResult(transaction, result, card.id);
      }

      if (initiator === 'merchant') {
        await this.markFailed(transaction.id, 'Aucune carte enregistrée');
        return this.result(transaction.id);
      }

      const webUrl = this.configService.get<string>('WEB_URL', 'http://localhost:3000');
      const back = new URLSearchParams({ transaction: transaction.id, next: safeReturnPath(params.returnPath) });
      const session = await this.provider.createCheckout({
        reference: transaction.id,
        amount: charge.totalAmount,
        currency: 'EUR',
        description: params.description,
        customer: { id: payer.id, email: payer.email, country: billingCountry },
        returnUrl: `${webUrl}/checkout/retour?${back.toString()}`,
        cancelUrl: `${webUrl}/checkout/retour?${back.toString()}&annule=1`,
      });

      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { providerPaymentId: session.id },
      });

      return { ...(await this.result(transaction.id)), status: 'requires_redirect', redirectUrl: session.redirectUrl };
    } catch (error) {
      const message = error instanceof PaymentProviderError ? error.message : (error as Error)?.message || 'Payment failed';
      await this.markFailed(transaction.id, message);
      this.logger.error(`Payment ${transaction.id} could not be started: ${message}`);
      throw new ServiceUnavailableException('Le paiement est momentanément indisponible, réessayez plus tard');
    }
  }

  /**
   * Current state of a payment of the fan (checkout return page, after the
   * provider's page), checking it is the expected purchase when given
   */
  async confirmPayment(
    userId: string,
    transactionId: string,
    expected: {
      kind?: PaymentKind;
      contentId?: string;
      creatorId?: string;
      /** Metadata values the transaction must carry (e.g. messageId) */
      metadata?: Record<string, string>;
    } = {},
  ): Promise<PaymentFlowResult> {
    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    const transactionMetadata = (transaction?.metadata as Record<string, unknown> | null) ?? {};

    if (
      !transaction ||
      transaction.fromUserId !== userId ||
      (expected.kind && transactionMetadata.kind !== expected.kind) ||
      (expected.contentId && transaction.contentId !== expected.contentId) ||
      (expected.creatorId && transaction.toUserId !== expected.creatorId) ||
      Object.entries(expected.metadata ?? {}).some(([key, value]) => transactionMetadata[key] !== value)
    ) {
      throw new NotFoundException('Payment not found');
    }

    return this.result(transaction.id);
  }

  /**
   * Payment seen from the checkout return page: status and what it bought, to
   * send the fan back to the right place
   */
  async getPaymentStatus(userId: string, transactionId: string) {
    const result = await this.confirmPayment(userId, transactionId);
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { toUser: { select: { username: true } } },
    });
    const metadata = (transaction?.metadata as Record<string, unknown> | null) ?? {};

    return {
      ...result,
      kind: metadata.kind ?? null,
      contentId: transaction?.contentId ?? null,
      messageId: typeof metadata.messageId === 'string' ? metadata.messageId : null,
      streamId: typeof metadata.streamId === 'string' ? metadata.streamId : null,
      creatorUsername: transaction?.toUser?.username ?? null,
    };
  }

  /**
   * The provider confirmed a payment (webhook, or the simulator). Saves the
   * card used and completes the transaction. Returns false when the payment is unknown.
   */
  async handlePaymentSucceeded(event: {
    reference: string;
    providerPaymentId?: string;
    providerTransactionId: string;
    amount: number;
    currency: string;
    card?: CardDetails;
  }): Promise<boolean> {
    const transaction = await this.findTransaction(event.reference, event.providerPaymentId, event.providerTransactionId);
    if (!transaction) {
      this.logger.warn(`Payment ${event.providerTransactionId} succeeded for an unknown transaction (${event.reference || 'no reference'})`);
      return false;
    }

    const cardId = event.card ? await this.saveCard(transaction.fromUserId, event.card) : transaction.paymentCardId;

    await this.completeTransaction(transaction.id, {
      providerTransactionId: event.providerTransactionId,
      providerPaymentId: event.providerPaymentId,
      amountCharged: event.amount,
      currency: event.currency,
      paymentCardId: cardId ?? undefined,
      cardCountry: event.card?.country ?? null,
    });
    return true;
  }

  async handlePaymentFailed(event: { reference: string; reason: string }) {
    const transaction = await this.findTransaction(event.reference);
    if (!transaction) return false;
    await this.markFailed(transaction.id, event.reason);
    return true;
  }

  /**
   * PENDING -> COMPLETED, then grant access, credit the creator and notify.
   * Returns true only for the call that actually completed the transaction.
   */
  async completeTransaction(
    transactionId: string,
    payment: {
      providerTransactionId: string;
      providerPaymentId?: string;
      /** Euros charged by the provider */
      amountCharged: number;
      currency: string;
      paymentCardId?: string;
      cardCountry?: string | null;
    },
  ) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) return false;

    // Never grant more than what was charged
    if (
      payment.amountCharged + 0.005 < Number(transaction.totalAmount) ||
      payment.currency.toUpperCase() !== transaction.currency.toUpperCase()
    ) {
      this.logger.error(
        `Payment ${payment.providerTransactionId} of ${payment.amountCharged} ${payment.currency} ` +
          `does not match transaction ${transaction.id} (${transaction.totalAmount} ${transaction.currency})`,
      );
      return false;
    }

    const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
    const kind = (metadata.kind as PaymentKind | undefined) ?? this.inferKind(transaction);
    const holdDays = await this.settingsService.getEarningsHoldDays();
    const evidence = (transaction.taxEvidence as Record<string, unknown> | null) ?? {};
    const handler = this.handlers.get(kind);

    const completed = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.transaction.updateMany({
        where: { id: transaction.id, status: { in: [...COMPLETABLE_STATUSES] } },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          failedAt: null,
          failureReason: null,
          providerTransactionId: payment.providerTransactionId,
          ...(payment.providerPaymentId && !transaction.providerPaymentId && { providerPaymentId: payment.providerPaymentId }),
          ...(payment.paymentCardId && { paymentCardId: payment.paymentCardId }),
          ...(payment.cardCountry && {
            taxEvidence: { ...evidence, cardCountry: normalizeCountry(payment.cardCountry) } as Prisma.InputJsonValue,
          }),
        },
      });

      // Already completed by the webhook, the saved card charge or the simulator (or refunded since)
      if (claimed.count === 0) return false;

      const current = await tx.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
      const amount = Number(current.amount);

      if (kind === 'content_unlock' && current.contentId) {
        await tx.contentUnlock.upsert({
          where: { contentId_userId: { contentId: current.contentId, userId: current.fromUserId } },
          create: { contentId: current.contentId, userId: current.fromUserId, paidAmount: amount },
          update: {},
        });
      }

      if (kind === 'message_unlock' && typeof metadata.messageId === 'string') {
        await tx.message.updateMany({
          where: { id: metadata.messageId, receiverId: current.fromUserId },
          data: { isPurchased: true },
        });
      }

      if (handler) {
        await handler.onCompleted(tx, current, metadata);
      }

      if (current.toUserId) {
        await this.balance.creditEarning(tx, {
          creatorId: current.toUserId,
          transactionId: current.id,
          amount: Number(current.netAmount),
          currency: current.currency,
          holdDays,
        });
        await tx.creatorProfile.updateMany({
          where: { userId: current.toUserId },
          data: { totalEarnings: { increment: Number(current.netAmount) } },
        });
      }

      await tx.subscriberProfile.updateMany({
        where: { userId: current.fromUserId },
        data: { totalSpent: { increment: Number(current.totalAmount) } },
      });

      return true;
    });

    if (!completed) return false;

    const done = await this.prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    this.logger.log(`Payment completed: ${done.id} (${kind}, ${Number(done.totalAmount).toFixed(2)} € incl. VAT)`);

    if (handler?.afterCompleted) {
      await handler.afterCompleted(done, metadata).catch((error) =>
        this.logger.error(`After-payment hook failed for ${done.id}: ${error.message}`),
      );
    } else if (kind !== 'subscription') {
      await this.afterCompletion(done, kind as OneTimePaymentKind, metadata);
    }
    return true;
  }

  /** Mark a payment that did not go through, and tell the hook of its kind */
  async markFailed(transactionId: string, reason: string) {
    const updated = await this.prisma.transaction.updateMany({
      where: { id: transactionId, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'FAILED', failedAt: new Date(), failureReason: reason.slice(0, 500) },
    });
    if (updated.count === 0) return;

    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) return;
    const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
    const handler = this.handlers.get((metadata.kind as PaymentKind) ?? this.inferKind(transaction));
    if (handler?.onFailed) {
      await handler.onFailed(transaction, metadata, reason).catch((error) =>
        this.logger.error(`Failed-payment hook failed for ${transactionId}: ${error.message}`),
      );
    }
  }

  /** Saved cards of the fan */
  async listCards(userId: string) {
    const cards = await this.prisma.paymentCard.findMany({
      where: { userId, deletedAt: null, provider: this.provider.name },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return cards.map((card) => ({
      id: card.id,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
      isDefault: card.isDefault,
      createdAt: card.createdAt,
    }));
  }

  async getOwnCard(userId: string, cardId: string) {
    const card = await this.prisma.paymentCard.findFirst({
      where: { id: cardId, userId, deletedAt: null, provider: this.provider.name },
    });
    if (!card) {
      throw new NotFoundException('Payment method not found');
    }
    return card;
  }

  /** Card to renew a subscription with: its own card, else the fan's default one */
  async findRenewalCard(userId: string, preferredCardId?: string | null) {
    if (preferredCardId) {
      const card = await this.prisma.paymentCard.findFirst({
        where: { id: preferredCardId, userId, deletedAt: null, provider: this.provider.name },
      });
      if (card) return card;
    }
    return this.prisma.paymentCard.findFirst({
      where: { userId, deletedAt: null, provider: this.provider.name },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Save (or refresh) a card returned by the provider; the first card becomes the default one */
  async saveCard(userId: string, card: CardDetails): Promise<string | null> {
    if (!card.token) return null;

    const existing = await this.prisma.paymentCard.findUnique({
      where: { provider_providerToken: { provider: this.provider.name, providerToken: card.token } },
    });
    if (existing && existing.userId !== userId) {
      this.logger.error(`Card token of user ${existing.userId} reported for user ${userId}: ignored`);
      return null;
    }

    const hasDefault = await this.prisma.paymentCard.count({ where: { userId, deletedAt: null, isDefault: true } });
    const data = {
      brand: card.brand ?? null,
      last4: card.last4 ?? null,
      expMonth: card.expMonth ?? null,
      expYear: card.expYear ?? null,
      country: normalizeCountry(card.country),
    };

    const saved = await this.prisma.paymentCard.upsert({
      where: { provider_providerToken: { provider: this.provider.name, providerToken: card.token } },
      create: { userId, provider: this.provider.name, providerToken: card.token, isDefault: hasDefault === 0, ...data },
      update: { ...data, deletedAt: null },
    });
    return saved.id;
  }

  private async applyChargeResult(
    transaction: Transaction,
    result: SavedCardChargeResult,
    cardId: string,
  ): Promise<PaymentFlowResult> {
    switch (result.status) {
      case 'approved':
        await this.completeTransaction(transaction.id, {
          providerTransactionId: result.providerTransactionId,
          providerPaymentId: result.providerPaymentId,
          amountCharged: result.amount,
          currency: transaction.currency,
          paymentCardId: cardId,
        });
        return this.result(transaction.id);
      case 'pending':
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { providerPaymentId: result.providerPaymentId, status: 'PROCESSING' },
        });
        return this.result(transaction.id);
      case 'requires_action':
        // Nobody can authenticate a renewal charged by the platform
        if ((transaction.metadata as Record<string, unknown> | null)?.initiator === 'merchant') {
          await this.markFailed(transaction.id, 'Authentification bancaire requise');
          return this.result(transaction.id);
        }
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { providerPaymentId: result.providerPaymentId },
        });
        return { ...(await this.result(transaction.id)), status: 'requires_redirect', redirectUrl: result.redirectUrl };
      case 'declined':
        await this.markFailed(transaction.id, result.reason);
        return this.result(transaction.id);
    }
  }

  /**
   * Notifications and realtime events, once per completed one-off payment
   */
  private async afterCompletion(transaction: Transaction, kind: OneTimePaymentKind, metadata: Record<string, unknown>) {
    if (!transaction.toUserId) return;

    // Creators see their prices excluding VAT
    const amount = Number(transaction.amount);
    const fromUser = await this.prisma.user.findUnique({
      where: { id: transaction.fromUserId },
      select: { id: true, username: true, displayName: true, avatar: true },
    });
    const fanName = fromUser?.displayName || fromUser?.username || 'Un fan';
    const message = typeof metadata.message === 'string' && metadata.message ? metadata.message : null;
    const streamId = typeof metadata.streamId === 'string' ? metadata.streamId : null;

    try {
      if (kind === 'tip') {
        await this.prisma.notification.create({
          data: {
            userId: transaction.toUserId,
            type: 'NEW_TIP',
            title: 'Nouveau pourboire !',
            message: `${fanName} vous a envoyé un pourboire de ${amount.toFixed(2)}€${message ? ` : ${message}` : ''}`,
            metadata: {
              fromUserId: transaction.fromUserId,
              amount,
              transactionId: transaction.id,
              ...(streamId && { streamId }),
            },
          },
        });
      } else if (kind === 'message_unlock') {
        await this.prisma.notification.create({
          data: {
            userId: transaction.toUserId,
            type: 'SYSTEM',
            title: 'Message débloqué',
            message: `${fanName} a débloqué votre message payant pour ${amount.toFixed(2)}€`,
            linkUrl: fromUser ? `/messages?user=${fromUser.username}` : '/messages',
            metadata: {
              kind: 'PPV_PURCHASE',
              fromUserId: transaction.fromUserId,
              messageId: typeof metadata.messageId === 'string' ? metadata.messageId : null,
              amount,
              transactionId: transaction.id,
            },
          },
        });
      } else {
        const isStream = kind === 'stream_access';
        await this.prisma.notification.create({
          data: {
            userId: transaction.toUserId,
            type: 'SYSTEM',
            title: isStream ? 'Accès au live acheté' : 'Contenu débloqué',
            message: isStream
              ? `${fanName} a acheté l'accès à votre live pour ${amount.toFixed(2)}€`
              : `${fanName} a débloqué votre contenu pour ${amount.toFixed(2)}€`,
            linkUrl: isStream ? null : `/content/${transaction.contentId}`,
            metadata: {
              kind: 'PPV_PURCHASE',
              fromUserId: transaction.fromUserId,
              ...(isStream ? { streamId: transaction.contentId } : { contentId: transaction.contentId }),
              amount,
              transactionId: transaction.id,
            },
          },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to notify creator for transaction ${transaction.id}: ${error.message}`);
    }

    if (kind === 'tip' && fromUser) {
      this.tipCompleted$.next({
        transactionId: transaction.id,
        streamId,
        creatorId: transaction.toUserId,
        fromUser,
        amount,
        message,
        menuItemId: typeof metadata.menuItemId === 'string' ? metadata.menuItemId : null,
        menuItemLabel: typeof metadata.menuItemLabel === 'string' ? metadata.menuItemLabel : null,
        completedAt: new Date(),
      });
    }
  }

  private async findTransaction(reference?: string, providerPaymentId?: string, providerTransactionId?: string) {
    if (reference && /^[0-9a-f-]{36}$/i.test(reference)) {
      const byReference = await this.prisma.transaction.findUnique({ where: { id: reference } });
      if (byReference) return byReference;
    }
    if (providerPaymentId) {
      const byPayment = await this.prisma.transaction.findUnique({ where: { providerPaymentId } });
      if (byPayment) return byPayment;
    }
    if (providerTransactionId) {
      return this.prisma.transaction.findFirst({
        where: { providerTransactionId, provider: this.provider.name, type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] } },
      });
    }
    return null;
  }

  private inferKind(transaction: { type: TransactionType }): PaymentKind {
    if (transaction.type === 'TIP') return 'tip';
    if (transaction.type === 'SUBSCRIPTION') return 'subscription';
    return 'content_unlock';
  }

  private async result(transactionId: string): Promise<PaymentFlowResult> {
    const transaction = await this.prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
    const status: PaymentFlowStatus =
      transaction.status === 'COMPLETED'
        ? 'completed'
        : transaction.status === 'FAILED' || transaction.status === 'CANCELLED'
          ? 'failed'
          : 'processing';

    return {
      status,
      completed: status === 'completed',
      transactionId: transaction.id,
      redirectUrl: null,
      amount: Number(transaction.amount),
      vatRate: Number(transaction.vatRate),
      vatAmount: Number(transaction.vatAmount),
      totalAmount: Number(transaction.totalAmount),
      failureReason: status === 'failed' ? transaction.failureReason : null,
    };
  }
}

/** Relative web path only (no open redirect) */
export function safeReturnPath(path: string | undefined | null): string {
  return path && /^\/(?!\/)[^\s\\]*$/.test(path) ? path : '/';
}
