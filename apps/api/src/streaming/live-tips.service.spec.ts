import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatGoalAmount, goalReachedMessage, LiveTipsService } from './live-tips.service';
import type { TipCompletedEvent } from '../payments/one-time-payment.service';

const decimal = (value: number) => new Prisma.Decimal(value);
const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });

const NBSP = ' ';

describe('LiveTipsService', () => {
  let service: LiveTipsService;
  let prisma: any;

  // In-memory state of the stream, its milestones, chat lines and actions
  let stream: { id: string; creatorId: string; status: string; tipTotal: any };
  let goals: any[];
  let messages: any[];
  let actions: any[];
  let goalSeq: number;

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

  const addGoal = (amount: number, label: string, extra: Record<string, unknown> = {}) => {
    const goal = {
      id: `goal-${++goalSeq}`,
      streamId: 'stream-1',
      amount: decimal(amount),
      label,
      position: goals.length,
      reachedAt: null,
      completedAt: null,
      ...extra,
    };
    goals.push(goal);
    return goal;
  };

  const matches = (goal: any, where: any = {}) =>
    (where.streamId === undefined || goal.streamId === where.streamId) &&
    (where.reachedAt !== null || goal.reachedAt === null) &&
    (where.amount?.lte === undefined || Number(goal.amount) <= where.amount.lte) &&
    (where.id?.in === undefined || where.id.in.includes(goal.id)) &&
    (where.id?.notIn === undefined || !where.id.notIn.includes(goal.id));

  const byAmount = (a: any, b: any) => Number(a.amount) - Number(b.amount);

  beforeEach(() => {
    stream = { id: 'stream-1', creatorId: 'creator-1', status: 'LIVE', tipTotal: decimal(0) };
    goals = [];
    messages = [];
    actions = [];
    goalSeq = 0;

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
        findFirst: jest.fn(),
        update: jest.fn(async ({ data }: any) => {
          if (data.tipTotal?.increment !== undefined) {
            stream.tipTotal = decimal(Number(stream.tipTotal) + data.tipTotal.increment);
          }
          return stream;
        }),
      },
      liveTipGoal: {
        findMany: jest.fn(async ({ where }: any) => goals.filter((g) => matches(g, where)).sort(byAmount)),
        findUnique: jest.fn(async ({ where }: any) => goals.find((g) => g.id === where.id) ?? null),
        deleteMany: jest.fn(async ({ where }: any) => {
          goals = goals.filter((g) => !matches(g, where));
        }),
        create: jest.fn(async ({ data }: any) => {
          const goal = { id: `goal-${++goalSeq}`, completedAt: null, ...data, amount: decimal(data.amount) };
          goals.push(goal);
          return goal;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const goal = goals.find((g) => g.id === where.id);
          Object.assign(goal, data, data.amount !== undefined ? { amount: decimal(data.amount) } : {});
          return goal;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const found = goals.filter((g) => matches(g, where));
          found.forEach((g) => Object.assign(g, data));
          return { count: found.length };
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

  describe('formatting', () => {
    it('formats milestone amounts in French euros', () => {
      expect(formatGoalAmount(100)).toBe(`100${NBSP}€`);
      expect(formatGoalAmount(12.5)).toBe(`12,50${NBSP}€`);
      expect(formatGoalAmount(1500)).toBe(`1${NBSP}500${NBSP}€`);
      expect(goalReachedMessage({ amount: 200, label: '30 minutes de live en plus' })).toBe(
        `🎯 Palier atteint : 200${NBSP}€ — 30 minutes de live en plus`,
      );
    });
  });

  describe('replaceGoals', () => {
    const replace = (input: unknown[], userId = 'creator-1') =>
      service.replaceGoals(userId, 'stream-1', { goals: input } as any);

    it('stores the milestones by amount (position = rank) with trimmed labels', async () => {
      const result = await replace([
        { amount: 500, label: ' Surprise ' },
        { amount: 100, label: 'Questions' },
        { amount: 200.5, label: '30 minutes de plus' },
      ]);

      expect(result.streamId).toBe('stream-1');
      expect(result.total).toBe(0);
      expect(result.goals.map((g) => [g.amount, g.label, g.position, g.reachedAt])).toEqual([
        [100, 'Questions', 0, null],
        [200.5, '30 minutes de plus', 1, null],
        [500, 'Surprise', 2, null],
      ]);
    });

    it('locks the stream row in the transaction before writing', async () => {
      await replace([{ amount: 100, label: 'A' }]);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.liveStream.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'stream-1' }, select: { tipTotal: true } }),
      );
    });

    it('accepts an empty list (no goals)', async () => {
      addGoal(100, 'A');
      await expect(replace([])).resolves.toEqual({ streamId: 'stream-1', total: 0, goals: [] });
      expect(goals).toEqual([]);
    });

    it('refuses more than 10 milestones', async () => {
      const input = Array.from({ length: 11 }, (_, i) => ({ amount: (i + 1) * 10, label: `Palier ${i}` }));
      await expect(replace(input)).rejects.toThrow('A live cannot have more than 10 tip goals');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('validates amounts: 1 to 100 000 €, two decimals at most, distinct', async () => {
      await expect(replace([{ amount: 0.99, label: 'A' }])).rejects.toThrow('between €1 and €100000');
      await expect(replace([{ amount: 100000.01, label: 'A' }])).rejects.toThrow(BadRequestException);
      await expect(replace([{ amount: Number.NaN, label: 'A' }])).rejects.toThrow(BadRequestException);
      await expect(replace([{ amount: '50', label: 'A' }])).rejects.toThrow(BadRequestException);
      await expect(replace([{ amount: 10.555, label: 'A' }])).rejects.toThrow('at most 2 decimals');
      await expect(
        replace([
          { amount: 100, label: 'A' },
          { amount: 100.0, label: 'B' },
        ]),
      ).rejects.toThrow('Tip goal amounts must be distinct');
      await expect(replace([{ amount: 1, label: 'A' }, { amount: 100000, label: 'B' }, { amount: 0.1 + 0.2 + 9.7, label: 'C' }])).resolves.toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('requires a label of 1 to 120 characters (trimmed)', async () => {
      await expect(replace([{ amount: 100, label: '   ' }])).rejects.toThrow('Tip goal label is required');
      await expect(replace([{ amount: 100 }])).rejects.toThrow('Tip goal label is required');
      await expect(replace([{ amount: 100, label: 'x'.repeat(121) }])).rejects.toThrow('at most 120 characters');
      await expect(replace([{ amount: 100, label: ` ${'x'.repeat(120)} ` }])).resolves.toBeDefined();
    });

    it('refuses the same id twice', async () => {
      const goal = addGoal(100, 'A');
      await expect(
        replace([
          { id: goal.id, amount: 100, label: 'A' },
          { id: goal.id, amount: 200, label: 'B' },
        ]),
      ).rejects.toThrow('Duplicate tip goal');
    });

    it("refuses another creator's stream, unknown streams and ended lives", async () => {
      await expect(replace([{ amount: 100, label: 'A' }], 'fan-1')).rejects.toThrow(ForbiddenException);
      prisma.liveStream.findUnique.mockResolvedValueOnce(null);
      await expect(replace([{ amount: 100, label: 'A' }])).rejects.toThrow(NotFoundException);

      stream.status = 'SCHEDULED';
      await expect(replace([{ amount: 100, label: 'A' }])).resolves.toBeDefined();
      for (const status of ['ENDED', 'CANCELLED']) {
        stream.status = status;
        await expect(replace([{ amount: 100, label: 'A' }])).rejects.toThrow(
          'Tip goals can only be changed before or during the live',
        );
      }
    });

    it('keeps the ids sent (and their reached / done state), creates the others and deletes the missing ones', async () => {
      const reachedAt = new Date('2026-10-20T12:00:00Z');
      const completedAt = new Date('2026-10-20T12:05:00Z');
      stream.tipTotal = decimal(120);
      const kept = addGoal(100, 'Questions', { reachedAt, completedAt });
      addGoal(300, 'Supprimé');
      const otherStream = { ...addGoal(50, 'Autre live'), streamId: 'stream-2' };
      goals[2] = otherStream;

      const result = await replace([
        { id: kept.id, amount: 100, label: 'Je réponds à toutes vos questions' },
        { id: otherStream.id, amount: 400, label: 'Pas à moi' },
        { amount: 250, label: 'Nouveau' },
      ]);

      expect(result.goals).toEqual([
        {
          id: kept.id,
          amount: 100,
          label: 'Je réponds à toutes vos questions',
          position: 0,
          reachedAt: reachedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        },
        expect.objectContaining({ amount: 250, label: 'Nouveau', position: 1, reachedAt: null }),
        expect.objectContaining({ amount: 400, label: 'Pas à moi', position: 2, reachedAt: null }),
      ]);
      // The other stream's milestone is untouched, a new one was created instead
      expect(result.goals[2].id).not.toBe(otherStream.id);
      expect(otherStream).toEqual(expect.objectContaining({ streamId: 'stream-2', label: 'Autre live' }));
      expect(prisma.liveTipGoal.deleteMany).toHaveBeenCalledWith({ where: { streamId: 'stream-1', id: { notIn: [kept.id] } } });
      expect(goals.some((g) => g.label === 'Supprimé')).toBe(false);
    });

    it('resets the reached / done state of a kept milestone whose amount changed', async () => {
      stream.tipTotal = decimal(120);
      const moved = addGoal(100, 'A', { reachedAt: new Date(), completedAt: new Date() });
      const lowered = addGoal(300, 'B');

      const result = await replace([
        { id: moved.id, amount: 150, label: 'A' },
        { id: lowered.id, amount: 110, label: 'B' },
      ]);

      expect(result.goals).toEqual([
        expect.objectContaining({ id: lowered.id, amount: 110, completedAt: null, reachedAt: expect.any(String) }),
        expect.objectContaining({ id: moved.id, amount: 150, reachedAt: null, completedAt: null }),
      ]);
    });

    it('stores new milestones already covered by the total as reached, without a chat announcement', async () => {
      stream.tipTotal = decimal(150);

      const result = await replace([
        { amount: 100, label: 'Déjà atteint' },
        { amount: 150, label: 'Pile atteint' },
        { amount: 200, label: 'À venir' },
      ]);

      expect(result.total).toBe(150);
      expect(result.goals.map((g) => [g.amount, g.reachedAt !== null])).toEqual([
        [100, true],
        [150, true],
        [200, false],
      ]);
      expect(prisma.streamMessage.create).not.toHaveBeenCalled();
      expect(messages).toEqual([]);

      // A later tip does not announce them either: only the next one
      const recorded = await service.recordTip(tip({ amount: 60 }));
      expect(recorded?.reachedGoals.map((g) => g.label)).toEqual(['À venir']);
      expect(messages.filter((m) => m.type === 'SYSTEM')).toHaveLength(1);
    });
  });

  describe('setGoalCompleted', () => {
    it('marks a reached milestone as done, then not done', async () => {
      const goal = addGoal(100, 'Questions', { reachedAt: new Date() });

      const done = await service.setGoalCompleted('creator-1', 'stream-1', goal.id, true);
      expect(done.streamId).toBe('stream-1');
      expect(done.goal).toEqual(expect.objectContaining({ id: goal.id, completedAt: expect.any(String) }));

      // Marking it done again keeps the first date
      const again = await service.setGoalCompleted('creator-1', 'stream-1', goal.id, true);
      expect(again.goal.completedAt).toBe(done.goal.completedAt);

      const undone = await service.setGoalCompleted('creator-1', 'stream-1', goal.id, false);
      expect(undone.goal.completedAt).toBeNull();
    });

    it('refuses a milestone that is not reached yet', async () => {
      const goal = addGoal(100, 'Questions');
      await expect(service.setGoalCompleted('creator-1', 'stream-1', goal.id, true)).rejects.toThrow(
        'Only a reached tip goal can be marked as done',
      );
      await expect(service.setGoalCompleted('creator-1', 'stream-1', goal.id, false)).rejects.toThrow(BadRequestException);
      expect(prisma.liveTipGoal.update).not.toHaveBeenCalled();
    });

    it("refuses anyone but the creator, another stream's milestone and invalid statuses", async () => {
      const goal = addGoal(100, 'Questions', { reachedAt: new Date() });
      await expect(service.setGoalCompleted('fan-1', 'stream-1', goal.id, true)).rejects.toThrow(ForbiddenException);
      goal.streamId = 'stream-2';
      await expect(service.setGoalCompleted('creator-1', 'stream-1', goal.id, true)).rejects.toThrow(NotFoundException);
      await expect(service.setGoalCompleted('creator-1', 'stream-1', 'missing', true)).rejects.toThrow(NotFoundException);
      await expect(service.setGoalCompleted('creator-1', 'stream-1', goal.id, 'yes' as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.liveTipGoal.update).not.toHaveBeenCalled();
    });
  });

  describe('getLatestGoals', () => {
    it("returns the milestones of the creator's last live (most recently started) that has some", async () => {
      prisma.liveStream.findFirst.mockResolvedValue({
        tipGoals: [
          { amount: decimal(100), label: 'Questions' },
          { amount: decimal(250.5), label: 'Surprise' },
        ],
      });

      await expect(service.getLatestGoals('creator-1', 'stream-new')).resolves.toEqual({
        goals: [
          { amount: 100, label: 'Questions' },
          { amount: 250.5, label: 'Surprise' },
        ],
      });
      expect(prisma.liveStream.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { creatorId: 'creator-1', tipGoals: { some: {} }, id: { not: 'stream-new' } },
          orderBy: [{ startedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        }),
      );
    });

    it('returns no milestones when no previous stream has some', async () => {
      prisma.liveStream.findFirst.mockResolvedValue(null);
      await expect(service.getLatestGoals('creator-1')).resolves.toEqual({ goals: [] });
      expect(prisma.liveStream.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { creatorId: 'creator-1', tipGoals: { some: {} } } }),
      );
    });
  });

  describe('getLiveTipState', () => {
    it('returns the total, the milestones by amount, the menu and the actions', async () => {
      stream.tipTotal = decimal(45);
      addGoal(300, 'Nouvelle caméra');
      addGoal(40, 'Questions', { reachedAt: new Date('2026-10-20T12:00:00Z') });

      const state = await service.getLiveTipState('stream-1');

      expect(state.tipTotal).toBe(45);
      expect(state.tipGoals.map((g) => [g.amount, g.label, !!g.reachedAt])).toEqual([
        [40, 'Questions', true],
        [300, 'Nouvelle caméra', false],
      ]);
      expect(state.tipMenu).toEqual([]);
      expect(state.pendingTipActions).toEqual([]);
    });

    it('is empty for an unknown stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValueOnce(null);
      await expect(service.getLiveTipState('missing')).resolves.toEqual({
        tipTotal: 0,
        tipGoals: [],
        tipMenu: [],
        pendingTipActions: [],
      });
    });
  });

  describe('recordTip', () => {
    it('counts the tip, persists its chat line and creates the requested action', async () => {
      addGoal(50, 'Nouvelle caméra');
      const recorded = await service.recordTip(tip());

      expect(Number(stream.tipTotal)).toBe(20);
      expect(messages).toEqual([
        expect.objectContaining({ type: 'TIP', tipAmount: 20, transactionId: 'tx-1', senderId: 'fan-1' }),
      ]);
      expect(recorded?.action).toEqual(
        expect.objectContaining({ label: 'Chanter une chanson', amount: 20, status: 'PENDING', menuItemId: 'item-1' }),
      );
      expect(recorded?.total).toBe(20);
      expect(recorded?.goals).toEqual([expect.objectContaining({ amount: 50, label: 'Nouvelle caméra', reachedAt: null })]);
      expect(recorded?.reachedGoals).toEqual([]);
      expect(recorded?.systemMessages).toEqual([]);
    });

    it('is idempotent on the transaction id (webhook and confirm both completing)', async () => {
      addGoal(20, 'Questions');
      const first = await service.recordTip(tip());
      await expect(service.recordTip(tip())).resolves.toBeNull();

      expect(first?.reachedGoals).toHaveLength(1);
      expect(Number(stream.tipTotal)).toBe(20);
      expect(messages.filter((m) => m.type === 'TIP')).toHaveLength(1);
      // The milestone is announced once
      expect(messages.filter((m) => m.type === 'SYSTEM')).toHaveLength(1);
      expect(actions).toHaveLength(1);
    });

    it('treats a concurrent duplicate (unique violation) as already recorded, without a second announcement', async () => {
      addGoal(20, 'Questions');
      await service.recordTip(tip());
      // The other call had not committed yet when this one checked
      prisma.streamMessage.findUnique.mockResolvedValueOnce(null);
      await expect(service.recordTip(tip())).resolves.toBeNull();
      expect(messages.filter((m) => m.type === 'TIP')).toHaveLength(1);
      expect(messages.filter((m) => m.type === 'SYSTEM')).toHaveLength(1);
      expect(Number(stream.tipTotal)).toBe(20);
    });

    it('creates no action for a free tip', async () => {
      const recorded = await service.recordTip(tip({ menuItemId: null, menuItemLabel: null, message: 'Bravo' }));
      expect(recorded?.action).toBeNull();
      expect(actions).toHaveLength(0);
      expect(messages[0].message).toBe('Bravo');
    });

    it('announces each milestone once, when the total first reaches it', async () => {
      addGoal(50, 'Questions');
      addGoal(100, 'Surprise');

      const first = await service.recordTip(tip({ transactionId: 'tx-1', amount: 30 }));
      const second = await service.recordTip(tip({ transactionId: 'tx-2', amount: 20 }));
      const third = await service.recordTip(tip({ transactionId: 'tx-3', amount: 10 }));

      expect(first?.reachedGoals).toEqual([]);
      expect(second?.reachedGoals).toEqual([expect.objectContaining({ amount: 50, label: 'Questions' })]);
      expect(second?.systemMessages).toEqual([
        expect.objectContaining({
          type: 'SYSTEM',
          senderId: 'creator-1',
          message: `🎯 Palier atteint : 50${NBSP}€ — Questions`,
        }),
      ]);
      expect(second?.goals.map((g) => !!g.reachedAt)).toEqual([true, false]);
      expect(third?.reachedGoals).toEqual([]);
      expect(third?.systemMessages).toEqual([]);
      expect(messages.filter((m) => m.type === 'SYSTEM')).toHaveLength(1);
    });

    it('unlocks several milestones with one big tip, one chat line each, by amount', async () => {
      addGoal(500, 'Surprise exclusive');
      addGoal(200, '30 minutes de live en plus');
      addGoal(100, 'Je réponds à toutes vos questions');
      stream.tipTotal = decimal(90);

      const recorded = await service.recordTip(tip({ amount: 150, menuItemId: null, menuItemLabel: null }));

      expect(recorded?.total).toBe(240);
      expect(recorded?.reachedGoals.map((g) => g.amount)).toEqual([100, 200]);
      expect(recorded?.systemMessages.map((m) => m.message)).toEqual([
        `🎯 Palier atteint : 100${NBSP}€ — Je réponds à toutes vos questions`,
        `🎯 Palier atteint : 200${NBSP}€ — 30 minutes de live en plus`,
      ]);
      expect(recorded?.goals.map((g) => [g.amount, !!g.reachedAt])).toEqual([
        [100, true],
        [200, true],
        [500, false],
      ]);
      // Only the milestones not reached yet are updated, in the same transaction
      expect(prisma.liveTipGoal.updateMany).toHaveBeenCalledWith({
        where: { id: { in: expect.arrayContaining(['goal-2', 'goal-3']) }, reachedAt: null },
        data: { reachedAt: expect.any(Date) },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
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
