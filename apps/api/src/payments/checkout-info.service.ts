import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { computeCharge, normalizeCountry } from '../common/utils/vat';
import { SettingsService } from '../settings/settings.service';
import { PaymentFlowService } from './payment-flow.service';
import { CheckoutItemType } from './dto/payments.dto';

/** Why a checkout cannot go through, so the web app explains it instead of failing at payment time */
export type CheckoutUnavailableReason =
  | 'PAYMENTS_DISABLED' // payment provider not configured
  | 'CREATOR_NOT_READY' // creator whose identity is not verified yet
  | 'TIPS_DISABLED'
  | 'OWN_ITEM'
  | 'NOT_PAID' // free tier / content or stream that is not pay-per-view
  | 'ENDED'; // stream over

export interface CheckoutInfo {
  type: CheckoutItemType;
  itemId: string;
  title: string;
  // Euros excluding VAT, as charged by the API; null for tips (the fan chooses)
  amount: number | null;
  // VAT of the fan's country added on top, and the total charged (null for tips:
  // the client computes them with vatRate)
  vatRate: number;
  vatAmount: number | null;
  totalAmount: number | null;
  // Country the VAT is computed for (fan's billing country), null when unknown
  billingCountry: string | null;
  // Digital content supplied immediately: the fan must waive the withdrawal right
  requiresWithdrawalWaiver: boolean;
  interval?: string;
  minimumTip?: number;
  maximumTip?: number;
  creator: { id: string; username: string; displayName: string | null; avatar: string | null };
  available: boolean;
  unavailableReason?: CheckoutUnavailableReason;
  // Already paid for: nothing to charge (PPV unlocked, stream bought, tier subscribed)
  alreadyOwned: boolean;
}

// Same limit as SendTipDto
export const MAXIMUM_TIP = 10000;

type ItemInfo = Omit<CheckoutInfo, 'vatRate' | 'vatAmount' | 'totalAmount' | 'billingCountry'>;

const creatorSelect = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  role: true,
  kycStatus: true,
  status: true,
  deletedAt: true,
} as const;

type CheckoutCreator = {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  role: string;
  kycStatus: string;
  status: string;
  deletedAt: Date | null;
};

/**
 * What the checkout page shows before paying: the price charged by the API
 * (never the amount from the URL), tip limits and whether payment is possible.
 */
@Injectable()
export class CheckoutInfoService {
  constructor(
    private prisma: PrismaService,
    private paymentFlow: PaymentFlowService,
    private settingsService: SettingsService,
  ) {}

  async getCheckoutInfo(userId: string, type: CheckoutItemType, itemId: string, country?: string): Promise<CheckoutInfo> {
    const info = await this.getItemInfo(userId, type, itemId);

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { billingCountry: true } });
    const billingCountry = normalizeCountry(country) ?? normalizeCountry(user?.billingCountry);
    const charge = computeCharge(info.amount ?? 0, await this.settingsService.getPlatformFeePercentage(), billingCountry);

    return {
      ...info,
      vatRate: charge.vatRate,
      vatAmount: info.amount === null ? null : charge.vatAmount,
      totalAmount: info.amount === null ? null : charge.totalAmount,
      billingCountry,
    };
  }

  private async getItemInfo(
    userId: string,
    type: CheckoutItemType,
    itemId: string,
  ): Promise<Omit<CheckoutInfo, 'vatRate' | 'vatAmount' | 'totalAmount' | 'billingCountry'>> {
    switch (type) {
      case CheckoutItemType.SUBSCRIPTION:
        return this.forSubscription(userId, itemId);
      case CheckoutItemType.PPV:
        return this.forContent(userId, itemId);
      case CheckoutItemType.STREAM:
        return this.forStream(userId, itemId);
      case CheckoutItemType.TIP:
        return this.forTip(userId, itemId);
    }
  }

  private async forSubscription(userId: string, tierId: string): Promise<ItemInfo> {
    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { id: tierId },
      include: { creator: { select: creatorSelect } },
    });

    if (!tier || !tier.isActive) {
      throw new NotFoundException('Tier not found');
    }

    const live = await this.prisma.subscription.findFirst({
      where: { subscriberId: userId, tierId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
      select: { id: true },
    });

    const amount = Number(tier.price);
    return this.build({
      type: CheckoutItemType.SUBSCRIPTION,
      itemId: tierId,
      title: tier.name,
      amount,
      interval: tier.interval,
      creator: tier.creator,
      userId,
      alreadyOwned: !!live,
      notPaid: amount <= 0,
    });
  }

  private async forContent(userId: string, contentId: string): Promise<ItemInfo> {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      include: { creator: { select: creatorSelect } },
    });

    if (!content || content.deletedAt || content.status !== 'PUBLISHED') {
      throw new NotFoundException('Content not found');
    }

    const unlock = await this.prisma.contentUnlock.findUnique({
      where: { contentId_userId: { contentId, userId } },
      select: { id: true },
    });

    const amount = content.ppvPrice ? Number(content.ppvPrice) : 0;
    return this.build({
      type: CheckoutItemType.PPV,
      itemId: contentId,
      title: content.title || 'Contenu exclusif',
      amount,
      creator: content.creator,
      userId,
      alreadyOwned: !!unlock,
      notPaid: !content.isPpv || amount <= 0,
    });
  }

  private async forStream(userId: string, streamId: string): Promise<ItemInfo> {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      include: { creator: { select: creatorSelect } },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    // Same purchase record as StreamingService.checkViewAccess
    const purchase = await this.prisma.transaction.findFirst({
      where: {
        fromUserId: userId,
        toUserId: stream.creatorId,
        type: 'PPV_UNLOCK',
        status: 'COMPLETED',
        contentId: stream.id,
      },
      select: { id: true },
    });

    const amount = stream.ppvPrice ? Number(stream.ppvPrice) : 0;
    return this.build({
      type: CheckoutItemType.STREAM,
      itemId: streamId,
      title: stream.title,
      amount,
      creator: stream.creator,
      userId,
      alreadyOwned: !!purchase,
      notPaid: !stream.isPpv || amount <= 0,
      ended: stream.status === 'ENDED' || stream.status === 'CANCELLED',
    });
  }

  private async forTip(userId: string, creatorId: string): Promise<ItemInfo> {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { ...creatorSelect, role: true, creatorProfile: { select: { allowTips: true, minimumTip: true } } },
    });

    if (!creator || creator.role !== 'CREATOR' || !creator.creatorProfile) {
      throw new NotFoundException('Creator not found');
    }

    return this.build({
      type: CheckoutItemType.TIP,
      itemId: creatorId,
      title: 'Pourboire',
      amount: null,
      minimumTip: Number(creator.creatorProfile.minimumTip),
      maximumTip: MAXIMUM_TIP,
      creator,
      userId,
      alreadyOwned: false,
      tipsDisabled: !creator.creatorProfile.allowTips,
    });
  }

  private build(params: {
    type: CheckoutItemType;
    itemId: string;
    title: string;
    amount: number | null;
    interval?: string;
    minimumTip?: number;
    maximumTip?: number;
    creator: CheckoutCreator;
    userId: string;
    alreadyOwned: boolean;
    notPaid?: boolean;
    ended?: boolean;
    tipsDisabled?: boolean;
  }): ItemInfo {
    const { creator } = params;

    // Most specific first: owning the item or the item itself beats platform setup
    let unavailableReason: CheckoutUnavailableReason | undefined;
    if (creator.id === params.userId) unavailableReason = 'OWN_ITEM';
    else if (params.notPaid) unavailableReason = 'NOT_PAID';
    else if (params.ended) unavailableReason = 'ENDED';
    else if (params.tipsDisabled) unavailableReason = 'TIPS_DISABLED';
    else if (!this.paymentFlow.isConfigured()) unavailableReason = 'PAYMENTS_DISABLED';
    else if (!PaymentFlowService.canSell(creator)) unavailableReason = 'CREATOR_NOT_READY';

    return {
      type: params.type,
      itemId: params.itemId,
      title: params.title,
      amount: params.amount,
      requiresWithdrawalWaiver: params.type !== CheckoutItemType.TIP,
      ...(params.interval && { interval: params.interval }),
      ...(params.minimumTip !== undefined && { minimumTip: params.minimumTip }),
      ...(params.maximumTip !== undefined && { maximumTip: params.maximumTip }),
      creator: {
        id: creator.id,
        username: creator.username,
        displayName: creator.displayName,
        avatar: creator.avatar,
      },
      available: !unavailableReason && !params.alreadyOwned,
      ...(unavailableReason && { unavailableReason }),
      alreadyOwned: params.alreadyOwned,
    };
  }
}
