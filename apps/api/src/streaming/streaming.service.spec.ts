import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
      update: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
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
    },
    subscription: {
      findMany: jest.fn(),
    },
    subscriptionTier: {
      findMany: jest.fn(),
    },
    transaction: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
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

  describe('getStreamById', () => {
    it('hides the stream key and reports access for viewers', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({
        ...baseStream,
        visibility: 'PRIVATE',
        streamKey: 'secret',
      });

      const result = await service.getStreamById('stream-1', 'user-1');
      expect(result.streamKey).toBeUndefined();
      expect(result.hasAccess).toBe(false);
      expect(result.accessDeniedReason).toBe('PRIVATE');
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

    it('lists upcoming scheduled streams without stream keys', async () => {
      mockPrismaService.liveStream.findMany.mockResolvedValue([{ ...listed[0], status: 'SCHEDULED' }]);

      const result = await service.getScheduledStreams();

      expect(result[0]).not.toHaveProperty('streamKey');
      expect(mockPrismaService.liveStream.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'SCHEDULED',
            scheduledFor: { gte: expect.any(Date) },
            visibility: { not: 'PRIVATE' },
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
});
