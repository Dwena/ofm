import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { roundMoney } from '../common/utils/money';
import type { TipCompletedEvent } from '../payments/one-time-payment.service';
import {
  MAX_TIP_GOAL_AMOUNT,
  MAX_TIP_GOAL_LABEL_LENGTH,
  MAX_TIP_GOALS,
  MAX_TIP_MENU_AMOUNT,
  MAX_TIP_MENU_ITEMS,
  ReplaceTipGoalsDto,
  ReplaceTipMenuDto,
  TipActionUpdateStatus,
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

/** Milestone of a live's donation goal (the pot is the live's tip total) */
export interface TipGoalView {
  id: string;
  /** Euros */
  amount: number;
  label: string;
  /** Rank by amount (ascending) */
  position: number;
  /** When the live's total reached the amount */
  reachedAt: string | null;
  /** When the creator marked it as done */
  completedAt: string | null;
}

/** Milestones of a live with its running total, as broadcast to the room */
export interface TipGoalsSnapshot {
  streamId: string;
  /** Euros */
  total: number;
  goals: TipGoalView[];
}

/** Amount and label of a milestone (live lists, goals of a previous live) */
export interface TipGoalSummary {
  /** Euros */
  amount: number;
  label: string;
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
  /** Euros of completed tips sent from the live (the pot of the milestones) */
  tipTotal: number;
  /** Milestones, by amount */
  tipGoals: TipGoalView[];
  tipMenu: TipMenuItemView[];
  pendingTipActions: TipActionView[];
}

const SENDER_SELECT = { id: true, username: true, displayName: true, avatar: true } as const;

type StoredChatMessage = Prisma.StreamMessageGetPayload<{ include: { sender: { select: typeof SENDER_SELECT } } }>;

type StoredTipGoal = {
  id: string;
  amount: Prisma.Decimal;
  label: string;
  position: number;
  reachedAt: Date | null;
  completedAt: Date | null;
};

/** Result of recording a completed tip in its live */
export interface RecordedLiveTip {
  creatorId: string;
  message: StoredChatMessage;
  action: TipActionView | null;
  /** Euros, after this tip */
  total: number;
  /** Every milestone of the live, after this tip */
  goals: TipGoalView[];
  /** Milestones this tip unlocked (several for a big tip), by amount */
  reachedGoals: TipGoalView[];
  /** One "Palier atteint" chat line per unlocked milestone, same order */
  systemMessages: StoredChatMessage[];
}

const MAX_RECENT_ACTIONS = 50;
const MAX_FINISHED_ACTIONS = 20;

const GOAL_ORDER: Prisma.LiveTipGoalOrderByWithRelationInput[] = [{ amount: 'asc' }, { position: 'asc' }];

/** "100 €", "12,50 €" (non-breaking spaces) */
export function formatGoalAmount(amount: number): string {
  const decimals = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
    .format(amount)
    .replace(/\s/g, ' ');
}

/** Chat line of a milestone unlocked during the live */
export function goalReachedMessage(goal: { amount: number; label: string }): string {
  return `🎯 Palier atteint : ${formatGoalAmount(goal.amount)} — ${goal.label}`;
}

/** Milestone as returned by the API (euros, ISO dates) */
export function toTipGoalView(goal: StoredTipGoal): TipGoalView {
  return {
    id: goal.id,
    amount: Number(goal.amount),
    label: goal.label,
    position: goal.position,
    reachedAt: goal.reachedAt ? goal.reachedAt.toISOString() : null,
    completedAt: goal.completedAt ? goal.completedAt.toISOString() : null,
  };
}

const hasTwoDecimalsAtMost =(amount: number) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;

/**
 * Tip menu ("paliers de dons"), donation goals (milestones on the live's
 * tip total) and tip actions of the live streams
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
   * Milestones of a stream, by amount
   */
  async getGoals(streamId: string, client: Prisma.TransactionClient = this.prisma): Promise<TipGoalView[]> {
    const goals = await client.liveTipGoal.findMany({ where: { streamId }, orderBy: GOAL_ORDER });
    return goals.map((goal) => this.toGoal(goal));
  }

  /**
   * The stream, when the user is its creator
   */
  private async getOwnStream(userId: string, streamId: string) {
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
    return stream;
  }

  /**
   * Replace the milestones of a scheduled or live stream, stored by amount.
   * Milestones sent with one of their ids are updated in place and keep their
   * reached / done state (reset when the amount changes), the others are
   * created and the missing ones deleted. A new milestone the total already
   * covers is stored as reached, without a chat announcement.
   */
  async replaceGoals(userId: string, streamId: string, dto: ReplaceTipGoalsDto): Promise<TipGoalsSnapshot> {
    const input: unknown = dto?.goals ?? [];
    if (!Array.isArray(input)) {
      throw new BadRequestException('Invalid tip goals');
    }
    if (input.length > MAX_TIP_GOALS) {
      throw new BadRequestException(`A live cannot have more than ${MAX_TIP_GOALS} tip goals`);
    }

    const goals = input.map((goal: { id?: unknown; amount?: unknown; label?: unknown }) => {
      const amount = typeof goal?.amount === 'number' ? goal.amount : Number.NaN;
      if (!Number.isFinite(amount) || amount < 1 || amount > MAX_TIP_GOAL_AMOUNT) {
        throw new BadRequestException(`Tip goal amount must be between €1 and €${MAX_TIP_GOAL_AMOUNT}`);
      }
      if (!hasTwoDecimalsAtMost(amount)) {
        throw new BadRequestException('Tip goal amount must have at most 2 decimals');
      }
      const label = typeof goal.label === 'string' ? goal.label.trim() : '';
      if (!label) {
        throw new BadRequestException('Tip goal label is required');
      }
      if (label.length > MAX_TIP_GOAL_LABEL_LENGTH) {
        throw new BadRequestException(`Tip goal label must be at most ${MAX_TIP_GOAL_LABEL_LENGTH} characters`);
      }
      const id = typeof goal.id === 'string' && goal.id ? goal.id : undefined;
      return { id, amount: roundMoney(amount), label };
    });

    if (new Set(goals.map((goal) => goal.amount)).size !== goals.length) {
      throw new BadRequestException('Tip goal amounts must be distinct');
    }
    const ids = goals.map((goal) => goal.id).filter((id): id is string => !!id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate tip goal');
    }

    const stream = await this.getOwnStream(userId, streamId);
    if (stream.status !== 'SCHEDULED' && stream.status !== 'LIVE') {
      throw new BadRequestException('Tip goals can only be changed before or during the live');
    }

    goals.sort((a, b) => a.amount - b.amount);

    return this.prisma.$transaction(async (tx) => {
      // Locks the stream row: a tip recorded meanwhile waits for the new milestones
      const locked = await tx.liveStream.update({
        where: { id: streamId },
        data: { updatedAt: new Date() },
        select: { tipTotal: true },
      });
      const total = Number(locked.tipTotal);
      const now = new Date();

      const existing = await tx.liveTipGoal.findMany({ where: { streamId } });
      const byId = new Map(existing.map((goal) => [goal.id, goal]));
      const keptIds = ids.filter((id) => byId.has(id));

      await tx.liveTipGoal.deleteMany({ where: { streamId, id: { notIn: keptIds } } });

      for (const [position, goal] of goals.entries()) {
        const current = goal.id ? byId.get(goal.id) : undefined;
        const coveredAt = goal.amount <= total ? now : null;
        if (current) {
          const amountChanged = Number(current.amount) !== goal.amount;
          await tx.liveTipGoal.update({
            where: { id: current.id },
            data: {
              amount: goal.amount,
              label: goal.label,
              position,
              ...(amountChanged
                ? { reachedAt: coveredAt, completedAt: null }
                : { reachedAt: current.reachedAt ?? coveredAt }),
            },
          });
        } else {
          // An unknown id (another stream's milestone, or deleted meanwhile) makes a new one
          await tx.liveTipGoal.create({
            data: { streamId, amount: goal.amount, label: goal.label, position, reachedAt: coveredAt },
          });
        }
      }

      return { streamId, total, goals: await this.getGoals(streamId, tx) };
    });
  }

  /**
   * Creator marks a reached milestone as done, or not done any more
   */
  async setGoalCompleted(
    userId: string,
    streamId: string,
    goalId: string,
    completed: boolean,
  ): Promise<{ streamId: string; goal: TipGoalView }> {
    if (typeof completed !== 'boolean') {
      throw new BadRequestException('Invalid tip goal status');
    }
    await this.getOwnStream(userId, streamId);

    const goal = await this.prisma.liveTipGoal.findUnique({ where: { id: goalId } });
    if (!goal || goal.streamId !== streamId) {
      throw new NotFoundException('Tip goal not found');
    }
    if (!goal.reachedAt) {
      throw new BadRequestException('Only a reached tip goal can be marked as done');
    }

    const updated = await this.prisma.liveTipGoal.update({
      where: { id: goalId },
      data: { completedAt: completed ? (goal.completedAt ?? new Date()) : null },
    });
    return { streamId, goal: this.toGoal(updated) };
  }

  /**
   * Milestones of the creator's most recent stream that has some (except
   * `excludeStreamId`), to set up the next live from them
   */
  async getLatestGoals(creatorId: string, excludeStreamId?: string): Promise<{ goals: TipGoalSummary[] }> {
    const stream = await this.prisma.liveStream.findFirst({
      where: {
        creatorId,
        tipGoals: { some: {} },
        ...(excludeStreamId && { id: { not: excludeStreamId } }),
      },
      // The live that took place last, then the most recently created (not started yet)
      orderBy: [{ startedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { tipGoals: { orderBy: GOAL_ORDER, select: { amount: true, label: true } } },
    });
    return {
      goals: (stream?.tipGoals ?? []).map((goal) => ({ amount: Number(goal.amount), label: goal.label })),
    };
  }

  /**
   * Running total, milestones, active menu and recent actions of a stream
   */
  async getLiveTipState(streamId: string): Promise<LiveTipState> {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { creatorId: true, tipTotal: true },
    });
    if (!stream) {
      return { tipTotal: 0, tipGoals: [], tipMenu: [], pendingTipActions: [] };
    }

    const [tipGoals, tipMenu, pendingTipActions] = await Promise.all([
      this.getGoals(streamId),
      this.getActiveMenu(stream.creatorId),
      this.getRecentActions(streamId),
    ]);

    return { tipTotal: Number(stream.tipTotal), tipGoals, tipMenu, pendingTipActions };
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
   * Record a completed tip sent from a live: running total, chat line,
   * action for a menu item and the milestones it unlocks (one "Palier
   * atteint" chat line each), in one database transaction. Idempotent on the
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
            message: tip.message || `a envoyé un pourboire de ${formatGoalAmount(amount)}`,
          },
          include: { sender: { select: SENDER_SELECT } },
        });

        // Also locks the stream row until the end of the transaction, so that
        // concurrent tips unlock each milestone only once
        const updated = await tx.liveStream.update({
          where: { id: streamId },
          data: { tipTotal: { increment: amount } },
          select: { tipTotal: true },
        });
        const total = Number(updated.tipTotal);

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

        const unlocked = await tx.liveTipGoal.findMany({
          where: { streamId, reachedAt: null, amount: { lte: total } },
          select: { id: true },
        });
        const unlockedIds = new Set(unlocked.map((goal) => goal.id));
        if (unlockedIds.size > 0) {
          await tx.liveTipGoal.updateMany({
            where: { id: { in: [...unlockedIds] }, reachedAt: null },
            data: { reachedAt: new Date() },
          });
        }

        const goals = await this.getGoals(streamId, tx);
        const reachedGoals = goals.filter((goal) => unlockedIds.has(goal.id));
        const systemMessages: StoredChatMessage[] = [];
        for (const goal of reachedGoals) {
          systemMessages.push(
            await tx.streamMessage.create({
              data: { streamId, senderId: stream.creatorId, type: 'SYSTEM', message: goalReachedMessage(goal) },
              include: { sender: { select: SENDER_SELECT } },
            }),
          );
        }

        return {
          creatorId: stream.creatorId,
          message,
          action: action ? this.toAction(action) : null,
          total,
          goals,
          reachedGoals,
          systemMessages,
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

  toGoal(goal: StoredTipGoal): TipGoalView {
    return toTipGoalView(goal);
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
