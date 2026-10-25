import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StreamingService } from './streaming.service';
import { PrismaService } from '../common/database/prisma.service';
import { OneTimePaymentService } from '../payments/one-time-payment.service';

describe('StreamingService', () => {
  let service: StreamingService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
    liveStream: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    streamViewer: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    streamMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
    },
    subscriptionTier: {
      findMany: jest.fn(),
    },
    transaction: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockOneTimePayments = {
    startPayment: jest.fn(),
    confirmPayment: jest.fn(),
  };

  const baseStream = {
    id: 'stream-1',
    creatorId: 'creator-1',
    visibility: 'PUBLIC',
    isPpv: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: { get: jest.fn((_key: string, fallback?: string) => fallback) } },
        { provide: OneTimePaymentService, useValue: mockOneTimePayments },
      ],
    }).compile();

    service = module.get<StreamingService>(StreamingService);

    jest.clearAllMocks();
    mockPrismaService.user.findUnique.mockResolvedValue({ role: 'SUBSCRIBER' });
  });

  describe('checkViewAccess', () => {
    it('always allows the creator', async () => {
      const result = await service.checkViewAccess('creator-1', { ...baseStream, visibility: 'PRIVATE' });
      expect(result).toEqual({ allowed: true, isCreator: true });
      expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('allows admins and moderators', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ role: 'MODERATOR' });
      const result = await service.checkViewAccess('mod-1', { ...baseStream, visibility: 'PRIVATE' });
      expect(result.allowed).toBe(true);
    });

    it('allows anyone on public streams', async () => {
      const result = await service.checkViewAccess('user-1', baseStream);
      expect(result).toEqual({ allowed: true, isCreator: false });
    });

    it('denies private streams to non-creators', async () => {
      const result = await service.checkViewAccess('user-1', { ...baseStream, visibility: 'PRIVATE' });
      expect(result).toEqual({ allowed: false, isCreator: false, reason: 'PRIVATE' });
    });

    it('requires an active subscription for subscriber-only streams', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([]);
      const denied = await service.checkViewAccess('user-1', { ...baseStream, visibility: 'SUBSCRIBERS_ONLY' });
      expect(denied.reason).toBe('SUBSCRIPTION_REQUIRED');

      const where = mockPrismaService.subscription.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ subscriberId: 'user-1', status: 'ACTIVE', tier: { creatorId: 'creator-1' } });

      mockPrismaService.subscription.findMany.mockResolvedValue([{ id: 'sub-1', tier: { price: 9.99 } }]);
      const allowed = await service.checkViewAccess('user-1', { ...baseStream, visibility: 'SUBSCRIBERS_ONLY' });
      expect(allowed.allowed).toBe(true);
    });

    it('requires a tier above the cheapest one for premium streams', async () => {
      mockPrismaService.subscriptionTier.findMany.mockResolvedValue([{ price: 5 }, { price: 20 }]);
      mockPrismaService.subscription.findMany.mockResolvedValue([{ id: 'sub-1', tier: { price: 5 } }]);

      const denied = await service.checkViewAccess('user-1', { ...baseStream, visibility: 'PREMIUM_SUBSCRIBERS' });
      expect(denied.reason).toBe('PREMIUM_SUBSCRIPTION_REQUIRED');

      mockPrismaService.subscription.findMany.mockResolvedValue([{ id: 'sub-2', tier: { price: 20 } }]);
      const allowed = await service.checkViewAccess('user-1', { ...baseStream, visibility: 'PREMIUM_SUBSCRIBERS' });
      expect(allowed.allowed).toBe(true);
    });

    it('treats the only tier as premium when all tiers cost the same', async () => {
      mockPrismaService.subscriptionTier.findMany.mockResolvedValue([{ price: 10 }]);
      mockPrismaService.subscription.findMany.mockResolvedValue([{ id: 'sub-1', tier: { price: 10 } }]);

      const result = await service.checkViewAccess('user-1', { ...baseStream, visibility: 'PREMIUM_SUBSCRIBERS' });
      expect(result.allowed).toBe(true);
    });

    it('requires a completed PPV unlock for PPV streams', async () => {
      mockPrismaService.transaction.findFirst.mockResolvedValue(null);
      const denied = await service.checkViewAccess('user-1', { ...baseStream, isPpv: true });
      expect(denied.reason).toBe('PPV_PURCHASE_REQUIRED');
      expect(mockPrismaService.transaction.findFirst.mock.calls[0][0].where).toMatchObject({
        fromUserId: 'user-1',
        type: 'PPV_UNLOCK',
        status: 'COMPLETED',
        contentId: 'stream-1',
      });

      mockPrismaService.transaction.findFirst.mockResolvedValue({ id: 'tx-1' });
      const allowed = await service.checkViewAccess('user-1', { ...baseStream, isPpv: true });
      expect(allowed.allowed).toBe(true);
    });
  });

  describe('joinStream', () => {
    it('throws when the stream does not exist', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue(null);
      await expect(service.joinStream('user-1', 'stream-1')).rejects.toThrow(NotFoundException);
    });

    it('throws when the stream is not live', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...baseStream, status: 'SCHEDULED' });
      await expect(service.joinStream('user-1', 'stream-1')).rejects.toThrow(BadRequestException);
    });

    it('throws when the viewer has no access', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...baseStream, visibility: 'PRIVATE', status: 'LIVE' });
      await expect(service.joinStream('user-1', 'stream-1')).rejects.toThrow(ForbiddenException);
    });

    it('registers the viewer', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...baseStream, status: 'LIVE' });
      mockPrismaService.streamViewer.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockResolvedValue([]);

      await service.joinStream('user-1', 'stream-1');
      expect(mockPrismaService.streamViewer.create).toHaveBeenCalledWith({
        data: { streamId: 'stream-1', viewerId: 'user-1' },
      });
    });
  });

  describe('registerViewer', () => {
    it('re-opens an existing session without counting a new view', async () => {
      mockPrismaService.streamViewer.findUnique.mockResolvedValue({ id: 'viewer-1' });

      const result = await service.registerViewer('stream-1', 'user-1');
      expect(result).toEqual({ firstView: false });
      expect(mockPrismaService.streamViewer.update).toHaveBeenCalledWith({
        where: { id: 'viewer-1' },
        data: { leftAt: null },
      });
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('creates a session and increments total views on first join', async () => {
      mockPrismaService.streamViewer.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockResolvedValue([]);

      const result = await service.registerViewer('stream-1', 'user-1');
      expect(result).toEqual({ firstView: true });
      expect(mockPrismaService.liveStream.update).toHaveBeenCalledWith({
        where: { id: 'stream-1' },
        data: { totalViews: { increment: 1 } },
      });
    });
  });

  describe('markViewerLeft', () => {
    it('only closes open sessions', async () => {
      mockPrismaService.streamViewer.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.markViewerLeft('stream-1', 'user-1')).toBe(false);
      expect(mockPrismaService.streamViewer.updateMany.mock.calls[0][0].where).toEqual({
        streamId: 'stream-1',
        viewerId: 'user-1',
        leftAt: null,
      });
    });
  });

  describe('updateViewerStats', () => {
    it('stores the count and raises the peak', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ peakViewers: 3, status: 'LIVE' });
      await service.updateViewerStats('stream-1', 5);
      expect(mockPrismaService.liveStream.update).toHaveBeenCalledWith({
        where: { id: 'stream-1' },
        data: { viewerCount: 5, peakViewers: 5 },
      });
    });

    it('keeps the peak when the count drops', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ peakViewers: 10, status: 'LIVE' });
      await service.updateViewerStats('stream-1', 2);
      expect(mockPrismaService.liveStream.update).toHaveBeenCalledWith({
        where: { id: 'stream-1' },
        data: { viewerCount: 2, peakViewers: 10 },
      });
    });

    it('keeps the highest count seen since the last write as peak', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ peakViewers: 3, status: 'LIVE' });
      await service.updateViewerStats('stream-1', 2, 7);
      expect(mockPrismaService.liveStream.update).toHaveBeenCalledWith({
        where: { id: 'stream-1' },
        data: { viewerCount: 2, peakViewers: 7 },
      });
    });

    it('does nothing once the stream has ended', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ peakViewers: 10, status: 'ENDED' });
      await service.updateViewerStats('stream-1', 0);
      expect(mockPrismaService.liveStream.update).not.toHaveBeenCalled();
    });
  });

  describe('createChatMessage', () => {
    it('rejects empty messages', async () => {
      await expect(service.createChatMessage('stream-1', 'user-1', '   ')).rejects.toThrow(BadRequestException);
    });

    it('rejects messages that are too long', async () => {
      await expect(service.createChatMessage('stream-1', 'user-1', 'a'.repeat(501))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('persists trimmed messages', async () => {
      mockPrismaService.streamMessage.create.mockResolvedValue({ id: 'msg-1' });
      await service.createChatMessage('stream-1', 'user-1', '  Salut  ');
      expect(mockPrismaService.streamMessage.create.mock.calls[0][0].data).toEqual({
        streamId: 'stream-1',
        senderId: 'user-1',
        message: 'Salut',
      });
    });
  });

  describe('endStream', () => {
    it('ends the stream and closes open viewer sessions', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({
        creatorId: 'creator-1',
        status: 'LIVE',
        startedAt: new Date(Date.now() - 60_000),
      });
      mockPrismaService.liveStream.update.mockResolvedValue({ id: 'stream-1', status: 'ENDED' });
      mockPrismaService.streamViewer.updateMany.mockResolvedValue({ count: 2 });

      await service.endStream('creator-1', 'stream-1');
      const data = mockPrismaService.liveStream.update.mock.calls[0][0].data;
      expect(data.status).toBe('ENDED');
      expect(data.viewerCount).toBe(0);
      expect(data.duration).toBeGreaterThanOrEqual(59);
      expect(mockPrismaService.streamViewer.updateMany.mock.calls[0][0].where).toEqual({
        streamId: 'stream-1',
        leftAt: null,
      });
    });

    it('forbids other users', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'LIVE' });
      await expect(service.endStream('user-1', 'stream-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createStream', () => {
    beforeEach(() => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: 'CREATOR',
        stripeAccountId: 'acct_1',
        stripeOnboarded: true,
      });
      mockPrismaService.liveStream.findFirst.mockResolvedValue(null);
      mockPrismaService.liveStream.create.mockImplementation(async ({ data }) => ({ id: 'stream-1', ...data }));
    });

    it('rejects a blank title', async () => {
      await expect(service.createStream('creator-1', { title: '   ' })).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.liveStream.create).not.toHaveBeenCalled();
    });

    it('rejects a schedule date in the past', async () => {
      await expect(
        service.createStream('creator-1', { title: 'Live', scheduledFor: new Date(Date.now() - 60_000).toISOString() }),
      ).rejects.toThrow('Scheduled date must be in the future');
    });

    it('requires a PPV price of at least 1 euro', async () => {
      await expect(service.createStream('creator-1', { title: 'Live', isPpv: true, ppvPrice: 0.5 })).rejects.toThrow(
        'PPV streams must have a valid price',
      );
    });

    it('refuses a second live while one is in progress', async () => {
      mockPrismaService.liveStream.findFirst.mockResolvedValue({ id: 'other' });
      await expect(service.createStream('creator-1', { title: 'Live' })).rejects.toThrow(
        'You already have a live stream in progress',
      );
    });

    it('schedules a stream without checking for a live in progress', async () => {
      mockPrismaService.liveStream.findFirst.mockResolvedValue({ id: 'other' });
      const scheduledFor = new Date(Date.now() + 3_600_000).toISOString();
      const result = await service.createStream('creator-1', { title: '  Live  ', scheduledFor });
      expect(result.status).toBe('SCHEDULED');
      expect(result.title).toBe('Live');
      expect(result.streamKey).toBeUndefined();
    });
  });

  describe('startStream', () => {
    it('refuses to start while another live is in progress', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'SCHEDULED' });
      mockPrismaService.liveStream.findFirst.mockResolvedValue({ id: 'other' });
      await expect(service.startStream('creator-1', 'stream-1')).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.liveStream.update).not.toHaveBeenCalled();
    });
  });

  describe('listing', () => {
    const stream = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      creatorId: 'creator-1',
      streamKey: `key-${id}`,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...extra,
    });

    it('never exposes stream keys and hides private lives from other users', async () => {
      mockPrismaService.liveStream.findMany.mockResolvedValue([stream('s1')]);
      const result = await service.getLiveStreams('user-1');
      expect(result[0]).not.toHaveProperty('streamKey');
      expect(mockPrismaService.liveStream.findMany.mock.calls[0][0].where.OR).toEqual([
        { visibility: { not: 'PRIVATE' } },
        { creatorId: 'user-1' },
      ]);
    });

    it('lists a creator\'s public lives for other users, without revenue', async () => {
      mockPrismaService.liveStream.findMany.mockResolvedValue([stream('s1')]);
      const result = await service.getCreatorStreams('creator-1', 'user-1');
      expect(mockPrismaService.liveStream.findMany.mock.calls[0][0].where).toEqual({
        creatorId: 'creator-1',
        visibility: { not: 'PRIVATE' },
      });
      expect(result[0]).not.toHaveProperty('streamKey');
      expect(result[0]).not.toHaveProperty('stats');
      expect(mockPrismaService.transaction.findMany).not.toHaveBeenCalled();
    });

    it('adds PPV sales and tips of each live for its creator', async () => {
      mockPrismaService.liveStream.findMany.mockResolvedValue([
        stream('s1', { tipTotal: 5 }),
        stream('s2', { tipTotal: 25.5 }),
        stream('s3', { tipTotal: 0 }),
      ]);
      mockPrismaService.transaction.findMany.mockResolvedValueOnce([
        { contentId: 's1', amount: 12.99 },
        { contentId: 's1', amount: 12.99 },
      ]);
      // Tips are counted in the database, totals come from LiveStream.tipTotal
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        { streamId: 's1', count: BigInt(1) },
        { streamId: 's2', count: BigInt(2) },
      ]);

      const result = (await service.getCreatorStreams('creator-1', 'creator-1')) as any[];
      expect(result.find((s) => s.id === 's1').stats).toEqual({ tipsCount: 1, tipsTotal: 5, ppvCount: 2, ppvTotal: 25.98 });
      expect(result.find((s) => s.id === 's2').stats).toEqual({ tipsCount: 2, tipsTotal: 25.5, ppvCount: 0, ppvTotal: 0 });
      expect(result.find((s) => s.id === 's3').stats).toEqual({ tipsCount: 0, tipsTotal: 0, ppvCount: 0, ppvTotal: 0 });
      // No in-memory scan of every tip of the creator anymore
      expect(mockPrismaService.transaction.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteChatMessage', () => {
    it('only deletes a message of the given stream', async () => {
      mockPrismaService.streamMessage.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.deleteChatMessage('stream-1', 'msg-1')).resolves.toBe(true);
      expect(mockPrismaService.streamMessage.deleteMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', streamId: 'stream-1' },
      });

      mockPrismaService.streamMessage.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.deleteChatMessage('stream-1', 'msg-2')).resolves.toBe(false);
    });
  });

  describe('getStreamById', () => {
    it('hides the stream key and reports access for viewers', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({
        ...baseStream,
        visibility: 'PRIVATE',
        streamKey: 'secret',
        creator: { id: 'creator-1', username: 'alice', creatorProfile: { allowTips: true, minimumTip: 5 } },
      });

      const result = await service.getStreamById('stream-1', 'user-1');
      expect(result.streamKey).toBeUndefined();
      expect(result.hasAccess).toBe(false);
      expect(result.accessDeniedReason).toBe('PRIVATE');
      expect(result.tips).toEqual({ allowed: true, minimum: 5 });
      expect(result.creator).not.toHaveProperty('creatorProfile');
    });
  });

  describe('stream listings', () => {
    const listed = [
      { ...baseStream, status: 'LIVE', streamKey: 'secret-1', creator: { id: 'creator-1' } },
      { ...baseStream, id: 'stream-2', status: 'LIVE', streamKey: 'secret-2', creator: { id: 'creator-1' } },
    ];

    it('lists live streams without stream keys and hides other creators\' private streams', async () => {
      mockPrismaService.liveStream.findMany.mockResolvedValue(listed);

      const result = await service.getLiveStreams('user-1');

      expect(result.map((s: any) => s.id)).toEqual(['stream-1', 'stream-2']);
      result.forEach((s: any) => expect(s).not.toHaveProperty('streamKey'));
      expect(mockPrismaService.liveStream.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'LIVE',
            OR: [{ visibility: { not: 'PRIVATE' } }, { creatorId: 'user-1' }],
          },
        }),
      );
    });

    it('adds the tip total and the next milestone to reach, fetched in the same query', async () => {
      mockPrismaService.liveStream.findMany.mockResolvedValue([
        {
          ...listed[0],
          tipTotal: new Prisma.Decimal(110),
          tipGoals: [{ amount: new Prisma.Decimal(250), label: 'Surprise exclusive' }],
          _count: { viewers: 3, tipGoals: 3 },
        },
        { ...listed[1], tipTotal: new Prisma.Decimal(0), tipGoals: [], _count: { viewers: 0, tipGoals: 0 } },
      ]);

      const result: any[] = await service.getLiveStreams('user-1');

      expect(result[0]).toEqual(
        expect.objectContaining({
          tipTotal: 110,
          tipGoalsCount: 3,
          nextTipGoal: { amount: 250, label: 'Surprise exclusive' },
        }),
      );
      expect(result[0]).not.toHaveProperty('tipGoals');
      expect(result[1]).toEqual(expect.objectContaining({ tipTotal: 0, tipGoalsCount: 0, nextTipGoal: null }));
      expect(mockPrismaService.liveStream.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.liveStream.findMany.mock.calls[0][0].include.tipGoals).toEqual({
        where: { reachedAt: null },
        orderBy: [{ amount: 'asc' }, { position: 'asc' }],
        take: 1,
        select: { amount: true, label: true },
      });
    });

    it('lists upcoming scheduled streams without stream keys', async () => {
      mockPrismaService.liveStream.findMany.mockResolvedValue([{ ...listed[0], status: 'SCHEDULED' }]);

      const result = await service.getScheduledStreams();

      expect(result[0]).not.toHaveProperty('streamKey');
      expect(mockPrismaService.liveStream.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'SCHEDULED',
            scheduledFor: { gte: expect.any(Date) },
            // Anonymous listing: PRIVATE streams excluded
            OR: [{ visibility: { not: 'PRIVATE' } }],
          }),
          orderBy: { scheduledFor: 'asc' },
        }),
      );
    });
  });

  describe('purchaseStream', () => {
    const ppvStream = {
      ...baseStream,
      title: 'Live PPV',
      isPpv: true,
      ppvPrice: 12.5,
      status: 'LIVE',
      creator: { username: 'creator' },
    };

    const pendingPayment = {
      status: 'requires_payment_method',
      completed: false,
      transactionId: 'tx-1',
      paymentIntentId: 'pi_1',
      clientSecret: 'secret',
      amount: 12.5,
    };

    it('starts a pending PPV_UNLOCK payment keyed by the stream id', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue(ppvStream);
      mockPrismaService.transaction.findFirst.mockResolvedValue(null);
      mockOneTimePayments.startPayment.mockResolvedValue(pendingPayment);

      const result = await service.purchaseStream('user-1', 'stream-1');

      expect(mockOneTimePayments.startPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          payerId: 'user-1',
          creatorId: 'creator-1',
          kind: 'stream_access',
          amount: 12.5,
          contentId: 'stream-1',
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ purchased: false, alreadyPurchased: false, clientSecret: 'secret' }),
      );
    });

    it('does not charge twice once access was bought', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue(ppvStream);
      mockPrismaService.transaction.findFirst.mockResolvedValue({ id: 'tx-paid' });

      const result = await service.purchaseStream('user-1', 'stream-1');

      expect(result).toEqual({ purchased: true, alreadyPurchased: true, streamId: 'stream-1' });
      expect(mockOneTimePayments.startPayment).not.toHaveBeenCalled();
    });

    it('refuses when another requirement (subscription) is missing', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...ppvStream, visibility: 'SUBSCRIBERS_ONLY' });
      mockPrismaService.subscription.findMany.mockResolvedValue([]);

      await expect(service.purchaseStream('user-1', 'stream-1')).rejects.toThrow(ForbiddenException);
      expect(mockOneTimePayments.startPayment).not.toHaveBeenCalled();
    });

    it('rejects non-PPV streams and the creator', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...ppvStream, isPpv: false });
      await expect(service.purchaseStream('user-1', 'stream-1')).rejects.toThrow(BadRequestException);

      mockPrismaService.liveStream.findUnique.mockResolvedValue(ppvStream);
      await expect(service.purchaseStream('creator-1', 'stream-1')).rejects.toThrow(BadRequestException);
    });

    it('confirms through the one-time payment flow', async () => {
      mockOneTimePayments.confirmPayment.mockResolvedValue({ ...pendingPayment, status: 'completed', completed: true });

      const result = await service.confirmStreamPurchase('user-1', 'stream-1', 'pi_1');

      expect(mockOneTimePayments.confirmPayment).toHaveBeenCalledWith('user-1', 'pi_1', {
        kind: 'stream_access',
        contentId: 'stream-1',
      });
      expect(result.purchased).toBe(true);
    });
  });

  describe('ingress secrets (stream key, RTMP ingest URL)', () => {
    const STREAM_KEY = 'stream_secretKey123';
    const STREAM_URL = `rtmp://ingest.example.com/live/${STREAM_KEY}`;
    const row = (extra: Record<string, unknown> = {}) => ({
      ...baseStream,
      status: 'LIVE',
      source: 'BROWSER',
      streamKey: STREAM_KEY,
      streamUrl: STREAM_URL,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      creator: { id: 'creator-1', username: 'alice', creatorProfile: { allowTips: true, minimumTip: 1 } },
      ...extra,
    });

    // Neither field, nor the key anywhere else in the serialized response
    const expectNoIngressSecrets = (value: unknown) => {
      const items = Array.isArray(value) ? value : [value];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item).not.toHaveProperty('streamKey');
        expect(item).not.toHaveProperty('streamUrl');
      }
      const json = JSON.stringify(value);
      expect(json).not.toContain(STREAM_KEY);
      expect(json).not.toContain('rtmp://');
    };

    it('hides them from viewers of the stream detail, allowed or not', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue(row());
      const allowed = await service.getStreamById('stream-1', 'user-1');
      expect(allowed.hasAccess).toBe(true);
      expectNoIngressSecrets(allowed);

      mockPrismaService.liveStream.findUnique.mockResolvedValue(row({ visibility: 'PRIVATE' }));
      const denied = await service.getStreamById('stream-1', 'user-1');
      expect(denied.hasAccess).toBe(false);
      expectNoIngressSecrets(denied);
    });

    it('hides them from anonymous requests and from admins/moderators', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue(row());
      expectNoIngressSecrets(await service.getStreamById('stream-1'));

      mockPrismaService.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
      const admin = await service.getStreamById('stream-1', 'admin-1');
      expect(admin.hasAccess).toBe(true);
      expectNoIngressSecrets(admin);
    });

    it('keeps them in the creator\'s own stream detail', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue(row());
      const result = await service.getStreamById('stream-1', 'creator-1');
      expect(result).toMatchObject({ streamKey: STREAM_KEY, streamUrl: STREAM_URL });
    });

    it('never lists them in the live and scheduled discovery lists', async () => {
      mockPrismaService.liveStream.findMany.mockResolvedValue([row(), row({ id: 'stream-2' })]);
      expectNoIngressSecrets(await service.getLiveStreams('user-1'));
      // Even the creator's own lives in the discovery list
      expectNoIngressSecrets(await service.getLiveStreams('creator-1'));

      mockPrismaService.liveStream.findMany.mockResolvedValue([row({ status: 'SCHEDULED' })]);
      expectNoIngressSecrets(await service.getScheduledStreams());
      expectNoIngressSecrets(await service.getScheduledStreams('user-1'));
    });

    it('never lists them in a creator\'s lives, for visitors or the creator', async () => {
      mockPrismaService.liveStream.findMany.mockResolvedValue([row({ tipGoals: [] })]);
      expectNoIngressSecrets(await service.getCreatorStreams('creator-1', 'user-1'));

      mockPrismaService.transaction.findMany.mockResolvedValue([]);
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      expectNoIngressSecrets(await service.getCreatorStreams('creator-1', 'creator-1'));
    });

    it('strips them from the update / start / end responses', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({
        creatorId: 'creator-1',
        status: 'SCHEDULED',
        source: 'BROWSER',
        startedAt: null,
      });
      mockPrismaService.liveStream.findFirst.mockResolvedValue(null);
      mockPrismaService.liveStream.update.mockResolvedValue(row());
      mockPrismaService.streamViewer.updateMany.mockResolvedValue({ count: 0 });

      expectNoIngressSecrets(await service.updateStream('creator-1', 'stream-1', { title: 'New title' }));
      expectNoIngressSecrets(await service.startStream('creator-1', 'stream-1'));
      expectNoIngressSecrets(await service.endStream('creator-1', 'stream-1'));
    });

    it('does not load them for the realtime access checks (socket join, LiveKit token)', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue(null);
      await service.getStreamForRealtime('stream-1');
      const { select } = mockPrismaService.liveStream.findUnique.mock.calls[0][0];
      expect(select).not.toHaveProperty('streamKey');
      expect(select).not.toHaveProperty('streamUrl');
    });
  });
});
