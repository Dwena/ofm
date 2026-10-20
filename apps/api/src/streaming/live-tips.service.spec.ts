import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LiveTipsService } from './live-tips.service';
import type { TipCompletedEvent } from '../payments/one-time-payment.service';

const decimal = (value: number) => new Prisma.Decimal(value);
const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });

describe('LiveTipsService', () => {
  let service: LiveTipsService;
  let prisma: any;

  // In-memory state of the stream, its chat lines and actions (for the completion path)
  let stream: { id: string; creatorId: string; status: string; tipGoalAmount: any; tipGoalLabel: string | null; tipTotal: any };
  let messages: any[];
  let actions: any[];

  const fan = { id: 'fan-1', username: 'sophie', displayName: 'Sophie', avatar: null };

  const tip = (overrides: Partial<TipCompletedEvent> = {}): TipCompletedEvent => ({
    transactionId: 'tx-1',
    streamId: 'stream-1',
    creatorId: 'creator-1',
    fromUser: fan,
    amount: 20,
    message: null,
    menuItemId: 'item-1',
    menuItemLabel: 'Chanter une chanson',
    completedAt: new Date('2026-10-20T12:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    stream = {
      id: 'stream-1',
      creatorId: 'creator-1',
      status: 'LIVE',
      tipGoalAmount: decimal(50),
      tipGoalLabel: 'Nouvelle caméra',
      tipTotal: decimal(0),
    };
    messages = [];
    actions = [];

    prisma = {
      creatorProfile: { findUnique: jest.fn().mockResolvedValue({ minimumTip: decimal(5) }) },
      liveTipMenuItem: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      liveStream: {
        findUnique: jest.fn(async () => stream),
        update: jest.fn(async ({ data }: any) => {
          if (data.tipTotal?.increment !== undefined) {
            stream.tipTotal = decimal(Number(stream.tipTotal) + data.tipTotal.increment);
          }
          if ('tipGoalAmount' in data) stream.tipGoalAmount = data.tipGoalAmount === null ? null : decimal(data.tipGoalAmount);
          if ('tipGoalLabel' in data) stream.tipGoalLabel = data.tipGoalLabel;
          return stream;
        }),
      },
      streamMessage: {
        findUnique: jest.fn(async ({ where }: any) => messages.find((m) => m.transactionId === where.transactionId) ?? null),
        create: jest.fn(async ({ data }: any) => {
          if (data.transactionId && messages.some((m) => m.transactionId === data.transactionId)) {
            throw duplicate();
          }
          const message = { id: `msg-${messages.length + 1}`, createdAt: new Date(), sender: fan, ...data };
          messages.push(message);
          return message;
        }),
      },
      liveTipAction: {
        create: jest.fn(async ({ data }: any) => {
          const action = { id: `action-${actions.length + 1}`, status: 'PENDING', createdAt: new Date(), completedAt: null, fromUser: fan, ...data, amount: decimal(data.amount) };
          actions.push(action);
          return action;
        }),
        findUnique: jest.fn(async ({ where }: any) => actions.find((a) => a.id === where.id) ?? null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(async ({ where, data }: any) => {
          const action = actions.find((a) => a.id === where.id);
          Object.assign(action, data);
          return action;
        }),
      },
    };
    // Interactive transactions run against the same fake (a throw rolls nothing back here,
    // the duplicate is detected before anything else is written)
    prisma.$transaction = jest.fn(async (fn: (tx: any) => unknown) => fn(prisma));

    service = new LiveTipsService(prisma);
  });

  describe('replaceMenu', () => {
    const item = (overrides: Record<string, unknown> = {}) => ({ label: 'Je chante', amount: 20, ...overrides });

    it('refuses more than 20 items', async () => {
      const items = Array.from({ length: 21 }, (_, i) => item({ label: `Item ${i}` }));
      await expect(service.replaceMenu('creator-1', { items } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("refuses an amount below the creator's minimum tip or above 10 000 €", async () => {
      await expect(service.replaceMenu('creator-1', { items: [item({ amount: 4.99 })] } as any)).rejects.toThrow(
        'Tip menu item amount must be between €5.00 and €10000.00',
      );
      await expect(service.replaceMenu('creator-1', { items: [item({ amount: 10000.01 })] } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('never accepts less than 1 € even when the minimum tip is lower', async () => {
      prisma.creatorProfile.findUnique.mockResolvedValue({ minimumTip: decimal(0) });
      await expect(service.replaceMenu('creator-1', { items: [item({ amount: 0.5 })] } as any)).rejects.toThrow(
        'between €1.00',
      );
    });

    it('requires a label and refuses duplicate ids', async () => {
      await expect(service.replaceMenu('creator-1', { items: [item({ label: '   ' })] } as any)).rejects.toThrow(
        'Tip menu item label is required',
      );
      const id = '6f1c1c3e-3b7a-4a8e-9a43-2a4c4f0f0b11';
      await expect(
        service.replaceMenu('creator-1', { items: [item({ id }), item({ id })] } as any),
      ).rejects.toThrow('Duplicate tip menu item');
    });

    it("keeps the ids of the creator's items, creates the others and deletes the missing ones", async () => {
      prisma.liveTipMenuItem.findMany
        .mockResolvedValueOnce([{ id: 'kept' }, { id: 'removed' }])
        .mockResolvedValueOnce([]);

      const menu = await service.replaceMenu('creator-1', {
        items: [
          item({ label: ' Nouveau ', emoji: '🎵', description: '' }),
          item({ id: 'kept', label: 'Gardé', amount: 10 }),
          item({ id: 'not-mine', label: 'Autre' }),
        ],
      } as any);

      expect(prisma.liveTipMenuItem.deleteMany).toHaveBeenCalledWith({
        where: { creatorId: 'creator-1', id: { notIn: ['kept'] } },
      });
      expect(prisma.liveTipMenuItem.update).toHaveBeenCalledWith({
        where: { id: 'kept' },
        data: expect.objectContaining({ label: 'Gardé', amount: 10, position: 1 }),
      });
      expect(prisma.liveTipMenuItem.create).toHaveBeenCalledTimes(2);
      expect(prisma.liveTipMenuItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ creatorId: 'creator-1', label: 'Nouveau', emoji: '🎵', description: null, position: 0 }),
      });
      expect(menu).toEqual({ items: [], minimumAmount: 5, maximumAmount: 10000, maxItems: 20 });
      // An id that is not one of the creator's items is never updated
      expect(prisma.liveTipMenuItem.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'not-mine' } }));
    });
  });

  describe('setTipGoal', () => {
    it('sets and clears the goal of a live', async () => {
      await expect(service.setTipGoal('creator-1', 'stream-1', { amount: 300, label: ' Nouvelle caméra ' })).resolves.toEqual({
        streamId: 'stream-1',
        amount: 300,
        label: 'Nouvelle caméra',
        total: 0,
      });

      await expect(service.setTipGoal('creator-1', 'stream-1', { amount: null, label: 'ignoré' })).resolves.toEqual({
        streamId: 'stream-1',
        amount: null,
        label: null,
        total: 0,
      });
    });

    it('is allowed while scheduled, not once the live is over', async () => {
      stream.status = 'SCHEDULED';
      await expect(service.setTipGoal('creator-1', 'stream-1', { amount: 100 })).resolves.toMatchObject({ amount: 100 });

      for (const status of ['ENDED', 'CANCELLED']) {
        stream.status = status;
        await expect(service.setTipGoal('creator-1', 'stream-1', { amount: 100 })).rejects.toThrow(BadRequestException);
      }
    });

    it("refuses another creator's stream and unknown streams", async () => {
      await expect(service.setTipGoal('fan-1', 'stream-1', { amount: 100 })).rejects.toThrow(ForbiddenException);
      prisma.liveStream.findUnique.mockResolvedValueOnce(null);
      await expect(service.setTipGoal('creator-1', 'missing', { amount: 100 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('recordTip', () => {
    it('counts the tip, persists its chat line and creates the requested action', async () => {
      const recorded = await service.recordTip(tip());

      expect(Number(stream.tipTotal)).toBe(20);
      expect(messages).toEqual([
        expect.objectContaining({ type: 'TIP', tipAmount: 20, transactionId: 'tx-1', senderId: 'fan-1' }),
      ]);
      expect(recorded?.action).toEqual(
        expect.objectContaining({ label: 'Chanter une chanson', amount: 20, status: 'PENDING', menuItemId: 'item-1' }),
      );
      expect(recorded?.goal).toEqual({ amount: 50, label: 'Nouvelle caméra', total: 20, reached: false });
      expect(recorded?.goalReachedNow).toBe(false);
    });

    it('is idempotent on the transaction id (webhook and confirm both completing)', async () => {
      await service.recordTip(tip());
      await expect(service.recordTip(tip())).resolves.toBeNull();

      expect(Number(stream.tipTotal)).toBe(20);
      expect(messages).toHaveLength(1);
      expect(actions).toHaveLength(1);
    });

    it('treats a concurrent duplicate (unique violation) as already recorded', async () => {
      await service.recordTip(tip());
      // The other call had not committed yet when this one checked
      prisma.streamMessage.findUnique.mockResolvedValueOnce(null);
      await expect(service.recordTip(tip())).resolves.toBeNull();
      expect(messages).toHaveLength(1);
    });

    it('creates no action for a free tip', async () => {
      const recorded = await service.recordTip(tip({ menuItemId: null, menuItemLabel: null, message: 'Bravo' }));
      expect(recorded?.action).toBeNull();
      expect(actions).toHaveLength(0);
      expect(messages[0].message).toBe('Bravo');
    });

    it('announces the goal once, when the total first reaches it', async () => {
      const first = await service.recordTip(tip({ transactionId: 'tx-1', amount: 30 }));
      const second = await service.recordTip(tip({ transactionId: 'tx-2', amount: 20 }));
      const third = await service.recordTip(tip({ transactionId: 'tx-3', amount: 10 }));

      expect(first?.goalReachedNow).toBe(false);
      expect(second?.goalReachedNow).toBe(true);
      expect(second?.goal.reached).toBe(true);
      expect(second?.systemMessage).toEqual(
        expect.objectContaining({ type: 'SYSTEM', message: 'Objectif atteint : Nouvelle caméra 🎉', senderId: 'creator-1' }),
      );
      expect(third?.goalReachedNow).toBe(false);
      expect(third?.goal.reached).toBe(true);
      expect(messages.filter((m) => m.type === 'SYSTEM')).toHaveLength(1);
    });

    it('ignores tips without a stream or for a stream of another creator', async () => {
      await expect(service.recordTip(tip({ streamId: null }))).resolves.toBeNull();
      await expect(service.recordTip(tip({ creatorId: 'someone-else' }))).resolves.toBeNull();
      expect(messages).toHaveLength(0);
      expect(Number(stream.tipTotal)).toBe(0);
    });
  });

  describe('updateTipAction', () => {
    beforeEach(async () => {
      await service.recordTip(tip());
    });

    it('lets the creator mark an action done', async () => {
      const action = await service.updateTipAction('creator-1', 'stream-1', 'action-1', 'DONE');
      expect(action).toEqual(expect.objectContaining({ id: 'action-1', status: 'DONE' }));
      expect(action.completedAt).not.toBeNull();
    });

    it('refuses anyone but the creator of the stream', async () => {
      await expect(service.updateTipAction('fan-1', 'stream-1', 'action-1', 'DONE')).rejects.toThrow(ForbiddenException);
      expect(prisma.liveTipAction.update).not.toHaveBeenCalled();
    });

    it('refuses an action of another stream and invalid statuses', async () => {
      actions[0].streamId = 'other-stream';
      await expect(service.updateTipAction('creator-1', 'stream-1', 'action-1', 'SKIPPED')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.updateTipAction('creator-1', 'stream-1', 'action-1', 'PENDING' as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
