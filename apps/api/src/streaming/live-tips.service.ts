import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { roundMoney } from '../common/utils/money';
import type { TipCompletedEvent } from '../payments/one-time-payment.service';
import {
  MAX_TIP_MENU_AMOUNT,
  MAX_TIP_MENU_ITEMS,
  ReplaceTipMenuDto,
  TipActionUpdateStatus,
  UpdateTipGoalDto,
} from './dto/tip-menu.dto';

/** Item of a creator's tip menu (amount in euros) */
export interface TipMenuItemView {
  id: string;
  label: string;
  description: string | null;
  amount: number;
  emoji: string | null;
  position: number;
  isActive: boolean;
}

export interface TipGoalView {
  /** Euros */
  amount: number;
  label: string | null;
  /** Euros of completed tips sent from the live */
  total: number;
}

export interface TipActionView {
  id: string;
  streamId: string;
  menuItemId: string | null;
  label: string;
  /** Euros */
  amount: number;
  status: 'PENDING' | 'DONE' | 'SKIPPED';
  createdAt: string;
  completedAt: string | null;
  fromUser: { id: string; username: string; displayName: string | null; avatar: string | null };
}

/** The creator's tip menu, with the bounds of an item amount (euros) */
export interface OwnTipMenu {
  items: TipMenuItemView[];
  minimumAmount: number;
  maximumAmount: number;
  maxItems: number;
}

/** Live tip state sent with the stream detail and the join acknowledgement */
export interface LiveTipState {
  tipGoal: TipGoalView | null;
  /** Euros of completed tips sent from the live (with or without a goal) */
  tipTotal: number;
  tipMenu: TipMenuItemView[];
  pendingTipActions: TipActionView[];
}

const SENDER_SELECT = { id: true, username: true, displayName: true, avatar: true } as const;

type StoredChatMessage = Prisma.StreamMessageGetPayload<{ include: { sender: { select: typeof SENDER_SELECT } } }>;

/** Result of recording a completed tip in its live (null fields when not applicable) */
export interface RecordedLiveTip {
  creatorId: string;
  message: StoredChatMessage;
  action: TipActionView | null;
  goal: { amount: number | null; label: string | null; total: number; reached: boolean };
  /** True only for the tip that made the total cross the goal */
  goalReachedNow: boolean;
  systemMessage: StoredChatMessage | null;
}

const MAX_RECENT_ACTIONS = 50;
const MAX_FINISHED_ACTIONS = 20;

const toNumber = (value: Prisma.Decimal | number | null | undefined) => (value == null ? null : Number(value));

/**
 * Tip menu ("paliers de dons"), tip goal and tip actions of the live streams
 */
@Injectable()
export class LiveTipsService {
  private readonly logger = new Logger(LiveTipsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Active items of a creator's tip menu, in display order
   */
  async getActiveMenu(creatorId: string): Promise<TipMenuItemView[]> {
    const items = await this.prisma.liveTipMenuItem.findMany({
      where: { creatorId, isActive: true },
      orderBy: { position: 'asc' },
    });
    return items.map((item) => this.toMenuItem(item));
  }

  /**
   * Whole tip menu of the creator (active and hidden items), for the editor
   */
  async getOwnMenu(creatorId: string): Promise<OwnTipMenu> {
    const [items, minimumAmount] = await Promise.all([
      this.prisma.liveTipMenuItem.findMany({
        where: { creatorId },
        orderBy: { position: 'asc' },
      }),
      this.getMinimumItemAmount(creatorId),
    ]);
    return {
      items: items.map((item) => this.toMenuItem(item)),
      minimumAmount,
      maximumAmount: MAX_TIP_MENU_AMOUNT,
      maxItems: MAX_TIP_MENU_ITEMS,
    };
  }

  /**
   * An item never costs less than the creator's minimum tip (and 1 €)
   */
  private async getMinimumItemAmount(creatorId: string) {
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { userId: creatorId },
      select: { minimumTip: true },
    });
    return Math.max(1, Number(profile?.minimumTip ?? 1));
  }

  /**
   * Replace the creator's tip menu. Items sent with the id of one of the
   * creator's items are updated in place (past actions keep referencing
   * them), the others are created, and the missing ones are deleted.
   */
  async replaceMenu(creatorId: string, dto: ReplaceTipMenuDto): Promise<OwnTipMenu> {
    const items = dto.items ?? [];
    if (items.length > MAX_TIP_MENU_ITEMS) {
      throw new BadRequestException(`A tip menu cannot have more than ${MAX_TIP_MENU_ITEMS} items`);
    }

    const minimum = await this.getMinimumItemAmount(creatorId);

    const seen = new Set<string>();
    for (const item of items) {
      const label = item.label?.trim();
      if (!label) {
        throw new BadRequestException('Tip menu item label is required');
      }
      const amount = roundMoney(Number(item.amount));
      if (!Number.isFinite(amount) || amount < minimum || amount > MAX_TIP_MENU_AMOUNT) {
        throw new BadRequestException(
          `Tip menu item amount must be between €${minimum.toFixed(2)} and €${MAX_TIP_MENU_AMOUNT.toFixed(2)}`,
        );
      }
      if (item.id) {
        if (seen.has(item.id)) {
          throw new BadRequestException('Duplicate tip menu item');
        }
        seen.add(item.id);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.liveTipMenuItem.findMany({ where: { creatorId }, select: { id: true } });
      const existingIds = new Set(existing.map((item) => item.id));
      const keptIds = items.map((item) => item.id).filter((id): id is string => !!id && existingIds.has(id));

      await tx.liveTipMenuItem.deleteMany({ where: { creatorId, id: { notIn: keptIds } } });

      for (const [position, item] of items.entries()) {
        const data = {
          label: item.label.trim(),
          description: item.description?.trim() || null,
          amount: roundMoney(Number(item.amount)),
          emoji: item.emoji?.trim() || null,
          position,
          isActive: item.isActive ?? true,
        };
        if (item.id && existingIds.has(item.id)) {
          await tx.liveTipMenuItem.update({ where: { id: item.id }, data });
        } else {
          // An unknown id (another creator's item, or deleted meanwhile) makes a new item
          await tx.liveTipMenuItem.create({ data: { ...data, creatorId } });
        }
      }
    });

    return this.getOwnMenu(creatorId);
  }

  /**
   * Set (or clear with amount null) the tip goal of a scheduled or live stream
   */
  async setTipGoal(userId: string, streamId: string, dto: UpdateTipGoalDto) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, creatorId: true, status: true },
    });
    if (!stream) {
      throw new NotFoundException('Stream not found');
    }
    if (stream.creatorId !== userId) {
      throw new ForbiddenException('You can only update your own streams');
    }
    if (stream.status !== 'SCHEDULED' && stream.status !== 'LIVE') {
      throw new BadRequestException('The tip goal can only be changed before or during the live');
    }

    const amount = dto.amount == null ? null : roundMoney(Number(dto.amount));
    if (amount !== null && !(amount >= 1)) {
      throw new BadRequestException('Invalid tip goal amount');
    }
    const label = amount === null ? null : dto.label?.trim() || null;

    const updated = await this.prisma.liveStream.update({
      where: { id: streamId },
      data: { tipGoalAmount: amount, tipGoalLabel: label },
      select: { tipGoalAmount: true, tipGoalLabel: true, tipTotal: true },
    });

    return {
      streamId,
      amount: toNumber(updated.tipGoalAmount),
      label: updated.tipGoalLabel,
      total: Number(updated.tipTotal),
    };
  }

  /**
   * Tip goal, active menu and recent actions of a stream
   */
  async getLiveTipState(streamId: string): Promise<LiveTipState> {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { creatorId: true, tipGoalAmount: true, tipGoalLabel: true, tipTotal: true },
    });
    if (!stream) {
      return { tipGoal: null, tipTotal: 0, tipMenu: [], pendingTipActions: [] };
    }

    const [tipMenu, pendingTipActions] = await Promise.all([
      this.getActiveMenu(stream.creatorId),
      this.getRecentActions(streamId),
    ]);

    return { tipGoal: this.toGoal(stream), tipTotal: Number(stream.tipTotal), tipMenu, pendingTipActions };
  }

  /**
   * Pending actions (oldest first) followed by the latest done / skipped ones
   */
  async getRecentActions(streamId: string): Promise<TipActionView[]> {
    const [pending, finished] = await Promise.all([
      this.prisma.liveTipAction.findMany({
        where: { streamId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: MAX_RECENT_ACTIONS,
        include: { fromUser: { select: SENDER_SELECT } },
      }),
      this.prisma.liveTipAction.findMany({
        where: { streamId, status: { not: 'PENDING' } },
        orderBy: { completedAt: 'desc' },
        take: MAX_FINISHED_ACTIONS,
        include: { fromUser: { select: SENDER_SELECT } },
      }),
    ]);
    return [...pending, ...finished].slice(0, MAX_RECENT_ACTIONS).map((action) => this.toAction(action));
  }

  /**
   * Record a completed tip sent from a live: running total, chat line and
   * action for a menu item, in one database transaction. Idempotent on the
   * transaction id (the chat line and the action are unique per tip), so a
   * tip completed twice (webhook + confirm) is only counted once: returns
   * null for the duplicate.
   */
  async recordTip(tip: TipCompletedEvent): Promise<RecordedLiveTip | null> {
    if (!tip.streamId) return null;
    const streamId = tip.streamId;
    const amount = roundMoney(tip.amount);
    const label = tip.menuItemLabel?.trim() || null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const stream = await tx.liveStream.findUnique({
          where: { id: streamId },
          select: { id: true, creatorId: true },
        });
        if (!stream || stream.creatorId !== tip.creatorId) {
          return null;
        }

        const recorded = await tx.streamMessage.findUnique({
          where: { transactionId: tip.transactionId },
          select: { id: true },
        });
        if (recorded) {
          this.logger.log(`Tip ${tip.transactionId} already recorded in stream ${streamId}`);
          return null;
        }

        // Also fails with P2002 when a concurrent call recorded the tip meanwhile
        const message = await tx.streamMessage.create({
          data: {
            streamId,
            senderId: tip.fromUser.id,
            type: 'TIP',
            tipAmount: amount,
            transactionId: tip.transactionId,
            message: tip.message || `a envoyé un pourboire de ${amount.toFixed(2)}€`,
          },
          include: { sender: { select: SENDER_SELECT } },
        });

        const updated = await tx.liveStream.update({
          where: { id: streamId },
          data: { tipTotal: { increment: amount } },
          select: { tipGoalAmount: true, tipGoalLabel: true, tipTotal: true },
        });

        const action = label
          ? await tx.liveTipAction.create({
              data: {
                streamId,
                transactionId: tip.transactionId,
                menuItemId: tip.menuItemId ?? null,
                label,
                amount,
                fromUserId: tip.fromUser.id,
              },
              include: { fromUser: { select: SENDER_SELECT } },
            })
          : null;

        const total = Number(updated.tipTotal);
        const goalAmount = toNumber(updated.tipGoalAmount);
        const previous = roundMoney(total - amount);
        const goalReachedNow = goalAmount !== null && previous < goalAmount && total >= goalAmount;

        const systemMessage = goalReachedNow
          ? await tx.streamMessage.create({
              data: {
                streamId,
                senderId: stream.creatorId,
                type: 'SYSTEM',
                message: `Objectif atteint : ${updated.tipGoalLabel || 'objectif de la live'} 🎉`,
              },
              include: { sender: { select: SENDER_SELECT } },
            })
          : null;

        return {
          creatorId: stream.creatorId,
          message,
          action: action ? this.toAction(action) : null,
          goal: {
            amount: goalAmount,
            label: updated.tipGoalLabel,
            total,
            reached: goalAmount !== null && total >= goalAmount,
          },
          goalReachedNow,
          systemMessage,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(`Tip ${tip.transactionId} already recorded in stream ${streamId}`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Creator marks a tip action as done or skipped
   */
  async updateTipAction(
    userId: string,
    streamId: string,
    actionId: string,
    status: TipActionUpdateStatus,
  ): Promise<TipActionView> {
    if (status !== 'DONE' && status !== 'SKIPPED') {
      throw new BadRequestException('Invalid status');
    }

    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { creatorId: true },
    });
    if (!stream) {
      throw new NotFoundException('Stream not found');
    }
    if (stream.creatorId !== userId) {
      throw new ForbiddenException('Only the creator can update tip actions');
    }

    const action = await this.prisma.liveTipAction.findUnique({ where: { id: actionId }, select: { streamId: true } });
    if (!action || action.streamId !== streamId) {
      throw new NotFoundException('Tip action not found');
    }

    const updated = await this.prisma.liveTipAction.update({
      where: { id: actionId },
      data: { status, completedAt: new Date() },
      include: { fromUser: { select: SENDER_SELECT } },
    });
    return this.toAction(updated);
  }

  /**
   * Labels of the menu items requested by tip chat lines (by transaction id)
   */
  async getActionLabels(transactionIds: string[]): Promise<Map<string, string>> {
    if (transactionIds.length === 0) return new Map();
    const actions = await this.prisma.liveTipAction.findMany({
      where: { transactionId: { in: transactionIds } },
      select: { transactionId: true, label: true },
    });
    return new Map(actions.map((action) => [action.transactionId, action.label]));
  }

  toGoal(stream: {
    tipGoalAmount: Prisma.Decimal | null;
    tipGoalLabel: string | null;
    tipTotal: Prisma.Decimal;
  }): TipGoalView | null {
    if (stream.tipGoalAmount == null) return null;
    return {
      amount: Number(stream.tipGoalAmount),
      label: stream.tipGoalLabel,
      total: Number(stream.tipTotal),
    };
  }

  private toMenuItem(item: {
    id: string;
    label: string;
    description: string | null;
    amount: Prisma.Decimal;
    emoji: string | null;
    position: number;
    isActive: boolean;
  }): TipMenuItemView {
    return {
      id: item.id,
      label: item.label,
      description: item.description,
      amount: Number(item.amount),
      emoji: item.emoji,
      position: item.position,
      isActive: item.isActive,
    };
  }

  private toAction(action: {
    id: string;
    streamId: string;
    menuItemId: string | null;
    label: string;
    amount: Prisma.Decimal;
    status: 'PENDING' | 'DONE' | 'SKIPPED';
    createdAt: Date;
    completedAt: Date | null;
    fromUser: { id: string; username: string; displayName: string | null; avatar: string | null };
  }): TipActionView {
    return {
      id: action.id,
      streamId: action.streamId,
      menuItemId: action.menuItemId,
      label: action.label,
      amount: Number(action.amount),
      status: action.status,
      createdAt: action.createdAt.toISOString(),
      completedAt: action.completedAt ? action.completedAt.toISOString() : null,
      fromUser: action.fromUser,
    };
  }
}
