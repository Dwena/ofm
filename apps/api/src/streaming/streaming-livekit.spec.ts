import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StreamingService } from './streaming.service';
import { StreamingGateway, AuthenticatedStreamSocket, streamRoom } from './streaming.gateway';
import { LiveKitService } from './livekit.service';
import { PrismaService } from '../common/database/prisma.service';
import { OneTimePaymentService } from '../payments/one-time-payment.service';

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

/**
 * Live video transport: LiveKit tokens and room lifecycle as seen from the
 * streaming service / gateway (LiveKitService itself: livekit.service.spec.ts)
 */
describe('Streaming with LiveKit', () => {
  const env = process.env;

  const mockPrismaService = {
    user: { findUnique: jest.fn() },
    liveStream: { findUnique: jest.fn(), update: jest.fn() },
    streamViewer: { updateMany: jest.fn() },
    subscription: { findMany: jest.fn() },
    subscriptionTier: { findMany: jest.fn() },
    transaction: { findFirst: jest.fn() },
  };

  const liveStream = {
    id: 'stream-1',
    creatorId: 'creator-1',
    visibility: 'PUBLIC',
    isPpv: false,
    status: 'LIVE',
  };

  const createService = async (liveKitEnv: Record<string, string | undefined>) => {
    process.env = { ...env, LIVEKIT_URL: undefined, LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined, ...liveKitEnv };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamingService,
        LiveKitService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: { get: jest.fn((_key: string, fallback?: string) => fallback) } },
        { provide: OneTimePaymentService, useValue: {} },
      ],
    }).compile();
    return { service: module.get(StreamingService), liveKit: module.get(LiveKitService) };
  };

  const LIVEKIT_ENV = {
    LIVEKIT_URL: 'ws://localhost:7880',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'a-long-development-secret-of-at-least-32-chars',
  };

  const user = (overrides: Record<string, unknown> = {}) => ({
    username: 'david',
    displayName: 'David',
    status: 'ACTIVE',
    role: 'SUBSCRIBER',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaService.liveStream.findUnique.mockResolvedValue(liveStream);
    mockPrismaService.user.findUnique.mockResolvedValue(user());
    mockPrismaService.subscription.findMany.mockResolvedValue([]);
    mockPrismaService.transaction.findFirst.mockResolvedValue(null);
  });

  afterAll(() => {
    process.env = env;
  });

  describe('P2P fallback (LiveKit not configured)', () => {
    it('announces the p2p transport and refuses LiveKit tokens with a clear 400', async () => {
      const { service, liveKit } = await createService({});
      expect(liveKit.enabled).toBe(false);
      expect(service.liveTransport).toBe('p2p');

      const error = await service.getLiveKitToken('user-1', 'stream-1').catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('LIVEKIT_DISABLED');
      expect(mockPrismaService.liveStream.findUnique).not.toHaveBeenCalled();
    });

    it('does not call LiveKit when a stream ends', async () => {
      const { service, liveKit } = await createService({});
      const deleteRoom = jest.spyOn(liveKit, 'deleteRoom');
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'LIVE', startedAt: null });
      mockPrismaService.liveStream.update.mockResolvedValue({ id: 'stream-1', status: 'ENDED' });
      mockPrismaService.streamViewer.updateMany.mockResolvedValue({ count: 0 });

      await service.endStream('creator-1', 'stream-1');
      expect(deleteRoom).not.toHaveBeenCalled();
    });
  });

  describe('getLiveKitToken', () => {
    it('gives the creator a publisher token while the stream is live', async () => {
      const { service } = await createService(LIVEKIT_ENV);
      mockPrismaService.user.findUnique.mockResolvedValue(user({ username: 'alice', displayName: 'Alice', role: 'CREATOR' }));

      const result = await service.getLiveKitToken('creator-1', 'stream-1');
      expect(result).toMatchObject({ url: 'ws://localhost:7880', room: 'live-stream-1', identity: 'creator-1', transport: 'livekit' });
      const claims = decode(result.token);
      expect(claims.name).toBe('Alice');
      expect(claims.video.canPublish).toBe(true);
      expect(claims.video.canPublishSources).toEqual(['camera', 'microphone']);
      expect(claims.video.hidden).toBeUndefined();
    });

    it('lets the creator watch its own live with a viewer token', async () => {
      const { service } = await createService(LIVEKIT_ENV);
      const result = await service.getLiveKitToken('creator-1', 'stream-1', 'viewer');
      expect(result.identity).toMatch(/^creator-1:/);
      expect(decode(result.token).video).toMatchObject({ canPublish: false, canSubscribe: true, hidden: true });
    });

    it('gives an allowed viewer a hidden subscribe-only token', async () => {
      const { service } = await createService(LIVEKIT_ENV);
      // A viewer cannot ask for a publisher token
      const result = await service.getLiveKitToken('user-1', 'stream-1', 'publisher');
      expect(result.identity).toMatch(/^user-1:/);
      expect(decode(result.token).video).toEqual({
        room: 'live-stream-1',
        roomJoin: true,
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
        hidden: true,
      });
    });

    it('returns 404 NOT_FOUND for an unknown stream', async () => {
      const { service } = await createService(LIVEKIT_ENV);
      mockPrismaService.liveStream.findUnique.mockResolvedValue(null);
      const error = await service.getLiveKitToken('user-1', 'nope').catch((e) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('NOT_FOUND');
    });

    it('returns 400 NOT_LIVE when the stream is not live (even for its creator)', async () => {
      const { service } = await createService(LIVEKIT_ENV);
      for (const status of ['SCHEDULED', 'ENDED']) {
        mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...liveStream, status });
        for (const userId of ['user-1', 'creator-1']) {
          const error = await service.getLiveKitToken(userId, 'stream-1').catch((e) => e);
          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.message).toBe('NOT_LIVE');
        }
      }
    });

    it('refuses viewers without the required subscription', async () => {
      const { service } = await createService(LIVEKIT_ENV);
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...liveStream, visibility: 'SUBSCRIBERS_ONLY' });
      const error = await service.getLiveKitToken('user-1', 'stream-1').catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('SUBSCRIPTION_REQUIRED');

      mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...liveStream, visibility: 'PRIVATE' });
      expect((await service.getLiveKitToken('user-1', 'stream-1').catch((e) => e)).message).toBe('PRIVATE');
    });

    it('refuses a PPV live that was not bought, and accepts it once bought', async () => {
      const { service } = await createService(LIVEKIT_ENV);
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...liveStream, isPpv: true });
      const error = await service.getLiveKitToken('user-1', 'stream-1').catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('PPV_PURCHASE_REQUIRED');

      mockPrismaService.transaction.findFirst.mockResolvedValue({ id: 'tx-1' });
      await expect(service.getLiveKitToken('user-1', 'stream-1')).resolves.toMatchObject({ transport: 'livekit' });
      expect(mockPrismaService.transaction.findFirst.mock.calls[1][0].where).toMatchObject({
        fromUserId: 'user-1',
        type: 'PPV_UNLOCK',
        status: 'COMPLETED',
        contentId: 'stream-1',
      });
    });

    it('refuses banned and suspended accounts', async () => {
      const { service } = await createService(LIVEKIT_ENV);
      for (const status of ['BANNED', 'SUSPENDED']) {
        mockPrismaService.user.findUnique.mockResolvedValue(user({ status }));
        const error = await service.getLiveKitToken('user-1', 'stream-1').catch((e) => e);
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe('ACCOUNT_SUSPENDED');
      }
    });
  });

  describe('end of the live', () => {
    it('deletes the LiveKit room when the stream ends', async () => {
      const { service, liveKit } = await createService(LIVEKIT_ENV);
      const deleteRoom = jest.spyOn(liveKit, 'deleteRoom').mockResolvedValue(true);
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'LIVE', startedAt: null });
      mockPrismaService.liveStream.update.mockResolvedValue({ id: 'stream-1', status: 'ENDED' });
      mockPrismaService.streamViewer.updateMany.mockResolvedValue({ count: 1 });

      await service.endStream('creator-1', 'stream-1');
      expect(deleteRoom).toHaveBeenCalledWith('stream-1');
    });

    it('still ends the stream when LiveKit is unreachable', async () => {
      const { service } = await createService({ ...LIVEKIT_ENV, LIVEKIT_URL: 'ws://127.0.0.1:1' });
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'LIVE', startedAt: null });
      mockPrismaService.liveStream.update.mockResolvedValue({ id: 'stream-1', status: 'ENDED' });
      mockPrismaService.streamViewer.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.endStream('creator-1', 'stream-1')).resolves.toMatchObject({ status: 'ENDED' });
    });
  });

  describe('gateway acknowledgements', () => {
    const streamingService = {
      getStreamForRealtime: jest.fn().mockResolvedValue(liveStream),
      checkViewAccess: jest.fn(async (userId: string) => ({ allowed: true, isCreator: userId === 'creator-1' })),
      registerViewer: jest.fn(),
      updateViewerStats: jest.fn(),
      getRecentChatMessages: jest.fn().mockResolvedValue([]),
    };
    const socket = (id: string, userId: string) =>
      ({ id, userId, join: jest.fn(), leave: jest.fn(), to: jest.fn(() => ({ emit: jest.fn() })) }) as unknown as AuthenticatedStreamSocket;

    const createGateway = (liveKit?: LiveKitService) => {
      const emitted: { target: string; event: string; payload: unknown }[] = [];
      const gateway = new StreamingGateway({} as any, {} as any, streamingService as any, undefined, undefined, liveKit);
      gateway.server = {
        to: jest.fn((target: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ target, event, payload }) })),
      } as any;
      return { gateway, emitted };
    };

    it('announces the transport when joining and broadcasting', async () => {
      const p2p = createGateway().gateway;
      expect(await p2p.handleJoinStream(socket('v1', 'user-1'), { streamId: 'stream-1' })).toMatchObject({ transport: 'p2p' });

      const { liveKit } = await createService(LIVEKIT_ENV);
      const { gateway } = createGateway(liveKit);
      expect(await gateway.handleJoinStream(socket('v2', 'user-2'), { streamId: 'stream-1' })).toMatchObject({
        success: true,
        transport: 'livekit',
      });
      expect(await gateway.handleStartBroadcast(socket('b1', 'creator-1'), { streamId: 'stream-1' })).toMatchObject({
        success: true,
        transport: 'livekit',
      });
    });

    it('relays the video viewer count from the LiveKit webhooks to the room', async () => {
      const { liveKit } = await createService(LIVEKIT_ENV);
      const { gateway, emitted } = createGateway(liveKit);
      gateway.onModuleInit();
      liveKit.handleWebhookEvent({ event: 'participant_joined', room: { name: 'live-stream-1' }, participant: { identity: 'user-1:ab' } } as any);
      gateway.onModuleDestroy();

      expect(emitted).toContainEqual({
        target: streamRoom('stream-1'),
        event: 'video-viewer-count',
        payload: { streamId: 'stream-1', count: 1 },
      });
    });
  });
});
