import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IngressInput, IngressVideoEncodingPreset, VideoCodec } from 'livekit-server-sdk';
import { StreamingService } from './streaming.service';
import { StreamingController } from './streaming.controller';
import { StreamingGateway, AuthenticatedStreamSocket } from './streaming.gateway';
import { LiveKitService } from './livekit.service';
import { LiveKitWebhookController } from './livekit-webhook.controller';
import {
  INGRESS_SERVICE_UNREACHABLE,
  INGRESS_UNAVAILABLE,
  LiveIngressService,
  ObsStatusEvent,
  ingressIdleRoomName,
} from './live-ingress.service';
import { PrismaService } from '../common/database/prisma.service';
import { OneTimePaymentService } from '../payments/one-time-payment.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

const ingressClient = {
  createIngress: jest.fn(),
  updateIngress: jest.fn(),
  deleteIngress: jest.fn(),
  listIngress: jest.fn(),
};
const ingressClientArgs: unknown[][] = [];

jest.mock('livekit-server-sdk', () => {
  const actual = jest.requireActual('livekit-server-sdk');
  return {
    ...actual,
    IngressClient: jest.fn().mockImplementation((...args: unknown[]) => {
      ingressClientArgs.push(args);
      return ingressClient;
    }),
  };
});

const LIVEKIT_ENV = {
  LIVEKIT_URL: 'ws://localhost:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'a-long-development-secret-of-at-least-32-chars',
};

const CREATOR = 'creator-1';
const KEY_1 = 'sk_secret_key_number_1';
const KEY_2 = 'sk_secret_key_number_2';

/**
 * "Diffuser avec OBS": the creator's LiveKit Ingress (IngressClient mocked),
 * its binding to the lives and the OBS status from the webhooks
 */
describe('LiveIngressService', () => {
  const env = process.env;

  // In-memory LiveIngress table
  let ingressRow: Record<string, any> | null;
  let liveStreams: Record<string, { id: string; creatorId: string; status: string; source: string; startedAt?: Date | null }>;

  const prisma = {
    user: { findUnique: jest.fn() },
    liveIngress: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (!ingressRow) return null;
        if (where.creatorId && where.creatorId !== ingressRow.creatorId) return null;
        if (where.ingressId && where.ingressId !== ingressRow.ingressId) return null;
        return { ...ingressRow };
      }),
      upsert: jest.fn(async ({ create, update }: any) => {
        ingressRow = ingressRow ? { ...ingressRow, ...update, updatedAt: new Date() } : { id: 'li-1', ...create, updatedAt: new Date() };
        return { ...ingressRow };
      }),
    },
    liveStream: {
      findUnique: jest.fn(async ({ where }: any) => liveStreams[where.id] ?? null),
      findFirst: jest.fn(async ({ where }: any) =>
        Object.values(liveStreams).find(
          (s) => s.creatorId === where.creatorId && s.status === where.status && (!where.source || s.source === where.source),
        ) ?? null,
      ),
      findMany: jest.fn(),
      create: jest.fn(async ({ data }: any) => {
        const stream = { id: 'stream-new', ...data };
        liveStreams[stream.id] = stream;
        return { ...stream, creator: { id: data.creatorId } };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        liveStreams[where.id] = { ...liveStreams[where.id], ...data };
        return { ...liveStreams[where.id], streamKey: 'legacy-key' };
      }),
    },
    streamViewer: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    subscription: { findMany: jest.fn().mockResolvedValue([]) },
    subscriptionTier: { findMany: jest.fn() },
    transaction: { findFirst: jest.fn() },
  };

  const createModule = async (liveKitEnv: Record<string, string | undefined>) => {
    process.env = { ...env, LIVEKIT_URL: undefined, LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined, ...liveKitEnv };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamingService,
        LiveKitService,
        LiveIngressService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn((_key: string, fallback?: string) => fallback) } },
        { provide: OneTimePaymentService, useValue: {} },
      ],
    }).compile();
    const ingress = module.get(LiveIngressService);
    // Never reach a real LiveKit server from the tests
    jest.spyOn(module.get(LiveKitService), 'deleteRoom').mockResolvedValue(true);
    const events: ObsStatusEvent[] = [];
    ingress.obsStatus$.subscribe((event) => events.push(event));
    return {
      ingress,
      streaming: module.get(StreamingService),
      liveKit: module.get(LiveKitService),
      events,
    };
  };

  const remoteIngress = (overrides: Record<string, unknown> = {}) => ({
    ingressId: 'IN_1',
    streamKey: KEY_1,
    url: 'rtmp://localhost:1935/live',
    roomName: ingressIdleRoomName(CREATOR),
    state: { status: 0, tracks: [] },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ingressClientArgs.length = 0;
    ingressRow = null;
    liveStreams = {
      'stream-1': { id: 'stream-1', creatorId: CREATOR, status: 'LIVE', source: 'OBS', startedAt: null },
    };
    prisma.user.findUnique.mockResolvedValue({ username: 'alice', displayName: 'Alice', role: 'CREATOR', status: 'ACTIVE' });
    ingressClient.createIngress.mockResolvedValue(remoteIngress());
    ingressClient.updateIngress.mockImplementation(async (ingressId: string, opts: any) => remoteIngress({ ingressId, ...opts }));
    ingressClient.deleteIngress.mockResolvedValue({});
    ingressClient.listIngress.mockResolvedValue([remoteIngress()]);
    delete process.env.LIVEKIT_INGRESS_RTMP_URL;
  });

  afterAll(() => {
    process.env = env;
  });

  describe('P2P mode (LiveKit not configured)', () => {
    it('refuses every ingress endpoint with 400 INGRESS_UNAVAILABLE', async () => {
      const { ingress } = await createModule({});
      expect(ingress.available).toBe(false);
      for (const call of [
        () => ingress.getIngress(CREATOR),
        () => ingress.resetKey(CREATOR),
      ]) {
        const error = await call().catch((e) => e);
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toBe(INGRESS_UNAVAILABLE);
      }
      expect(ingressClient.createIngress).not.toHaveBeenCalled();
    });

    it('refuses to create or start a live in OBS mode, browser mode still works', async () => {
      const { streaming } = await createModule({});
      liveStreams = {};
      const error = await streaming.createStream(CREATOR, { title: 'OBS', source: 'OBS' }).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(INGRESS_UNAVAILABLE);
      expect(prisma.liveStream.create).not.toHaveBeenCalled();

      await expect(streaming.createStream(CREATOR, { title: 'Caméra' })).resolves.toMatchObject({ source: 'BROWSER' });
    });

    it('ends a live without touching any ingress', async () => {
      const { streaming } = await createModule({});
      await streaming.endStream(CREATOR, 'stream-1');
      expect(ingressClient.updateIngress).not.toHaveBeenCalled();
    });
  });

  describe('ingress creation', () => {
    it('creates an RTMP ingress on first read, in the idle room, as the creator, transcoded into simulcast layers', async () => {
      const { ingress } = await createModule(LIVEKIT_ENV);
      liveStreams = {};
      const view = await ingress.getIngress(CREATOR);

      expect(ingressClientArgs[0]).toEqual(['http://localhost:7880', 'devkey', LIVEKIT_ENV.LIVEKIT_API_SECRET, expect.any(Object)]);
      const [input, options] = ingressClient.createIngress.mock.calls[0];
      expect(input).toBe(IngressInput.RTMP_INPUT);
      expect(options).toMatchObject({
        name: `obs-${CREATOR}`,
        roomName: ingressIdleRoomName(CREATOR),
        participantIdentity: CREATOR,
        participantName: 'Alice',
        enableTranscoding: true,
      });
      expect(options.bypassTranscoding).toBeUndefined();
      expect(options.video.encodingOptions).toEqual({
        case: 'preset',
        value: IngressVideoEncodingPreset.H264_720P_30FPS_3_LAYERS,
      });
      expect(options.audio).toBeDefined();
      expect(view).toEqual({
        serverUrl: 'rtmp://localhost:1935/live',
        streamKey: KEY_1,
        status: 'offline',
        streamId: null,
        updatedAt: expect.any(Date),
      });
      expect(prisma.liveIngress.upsert).toHaveBeenCalledTimes(1);

      // Later reads reuse it (and refresh its state from LiveKit)
      await ingress.getIngress(CREATOR);
      expect(ingressClient.createIngress).toHaveBeenCalledTimes(1);
      expect(ingressClient.listIngress).toHaveBeenCalledWith({ ingressId: 'IN_1' });
    });

    it('uses 1080p or VP8 layers on request', async () => {
      const { ingress } = await createModule(LIVEKIT_ENV);
      liveStreams = {};
      process.env.LIVEKIT_INGRESS_RTMP_PRESET = '1080p';
      await ingress.resetKey(CREATOR);
      expect(ingressClient.createIngress.mock.calls[0][1].video.encodingOptions.value).toBe(
        IngressVideoEncodingPreset.H264_1080P_30FPS_3_LAYERS,
      );
      delete process.env.LIVEKIT_INGRESS_RTMP_PRESET;

      // VP8 layers on request (browsers without H.264 WebRTC decoding)
      process.env.LIVEKIT_INGRESS_RTMP_CODEC = 'vp8';
      await ingress.resetKey(CREATOR);
      const vp8 = ingressClient.createIngress.mock.calls[1][1].video.encodingOptions;
      expect(vp8.case).toBe('options');
      expect(vp8.value.videoCodec).toBe(VideoCodec.VP8);
      expect(vp8.value.layers.map((layer: { height: number }) => layer.height)).toEqual([720, 360, 180]);
      delete process.env.LIVEKIT_INGRESS_RTMP_CODEC;
    });

    it('prefers the public RTMP URL of the environment', async () => {
      const { ingress } = await createModule(LIVEKIT_ENV);
      process.env.LIVEKIT_INGRESS_RTMP_URL = 'rtmp://live.fanvip.example/live';
      expect((await ingress.getIngress(CREATOR)).serverUrl).toBe('rtmp://live.fanvip.example/live');
    });

    it('answers 503 INGRESS_SERVICE_UNREACHABLE when LiveKit refuses (e.g. no ingress service)', async () => {
      const { ingress } = await createModule(LIVEKIT_ENV);
      ingressClient.createIngress.mockRejectedValue(new Error('ingress not connected (redis required)'));
      const error = await ingress.getIngress(CREATOR).catch((e) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toBe(INGRESS_SERVICE_UNREACHABLE);
      expect(ingressRow).toBeNull();
    });
  });

  describe('stream key', () => {
    it('reset-key deletes and recreates the ingress', async () => {
      const { ingress } = await createModule(LIVEKIT_ENV);
      liveStreams = {};
      await ingress.getIngress(CREATOR);
      ingressClient.createIngress.mockResolvedValueOnce(
        remoteIngress({ ingressId: 'IN_2', streamKey: KEY_2, url: 'rtmp://localhost:1935/live' }),
      );

      const view = await ingress.resetKey(CREATOR);
      expect(view.streamKey).toBe(KEY_2);
      expect(ingressClient.createIngress.mock.calls[1][0]).toBe(IngressInput.RTMP_INPUT);
      expect(ingressClient.deleteIngress).toHaveBeenCalledWith('IN_1');
    });

    it('a new key during an OBS live keeps the ingress bound to the live', async () => {
      const { ingress } = await createModule(LIVEKIT_ENV);
      await ingress.resetKey(CREATOR);
      expect(ingressClient.createIngress.mock.calls[0][1].roomName).toBe('live-stream-1');
    });

    it('never logs the stream key', async () => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      );
      const { ingress, streaming } = await createModule(LIVEKIT_ENV);
      await ingress.getIngress(CREATOR);
      await ingress.resetKey(CREATOR);
      await streaming.endStream(CREATOR, 'stream-1');
      ingressClient.createIngress.mockRejectedValue(new Error('boom'));
      await ingress.resetKey(CREATOR).catch(() => undefined);

      const logged = spies.flatMap((spy) => spy.mock.calls.flat()).map(String).join('\n');
      expect(logged).not.toContain(KEY_1);
      expect(logged.length).toBeGreaterThan(0);
      spies.forEach((spy) => spy.mockRestore());
    });
  });

  describe('binding to the lives', () => {
    it('binds the ingress to the room of a live created in OBS mode, as the creator', async () => {
      const { streaming } = await createModule(LIVEKIT_ENV);
      liveStreams = {};
      const stream = await streaming.createStream(CREATOR, { title: 'Mon live OBS', source: 'OBS' });

      expect(stream).toMatchObject({ status: 'LIVE', source: 'OBS' });
      expect(ingressClient.createIngress).toHaveBeenCalledTimes(1);
      expect(ingressClient.updateIngress).toHaveBeenCalledWith('IN_1', {
        name: `obs-${CREATOR}`,
        roomName: 'live-stream-new',
        participantIdentity: CREATOR,
        participantName: 'Alice',
      });
    });

    it('a scheduled OBS live is only bound when it starts, and the source can change at start', async () => {
      const { streaming } = await createModule(LIVEKIT_ENV);
      liveStreams = { 'stream-2': { id: 'stream-2', creatorId: CREATOR, status: 'SCHEDULED', source: 'BROWSER' } };

      await streaming.startStream(CREATOR, 'stream-2', 'OBS');
      expect(liveStreams['stream-2']).toMatchObject({ status: 'LIVE', source: 'OBS' });
      expect(ingressClient.updateIngress).toHaveBeenCalledWith('IN_1', expect.objectContaining({ roomName: 'live-stream-2' }));
    });

    it('a browser live never touches the ingress', async () => {
      const { streaming } = await createModule(LIVEKIT_ENV);
      liveStreams = { 'stream-2': { id: 'stream-2', creatorId: CREATOR, status: 'SCHEDULED', source: 'BROWSER' } };
      await streaming.startStream(CREATOR, 'stream-2');
      expect(ingressClient.createIngress).not.toHaveBeenCalled();
      expect(ingressClient.updateIngress).not.toHaveBeenCalled();
    });

    it('unbinds the ingress (idle room) before deleting the room when the live ends', async () => {
      const { streaming, liveKit } = await createModule(LIVEKIT_ENV);
      ingressRow = { creatorId: CREATOR, ingressId: 'IN_1', streamKey: KEY_1, url: 'u', updatedAt: new Date() };
      const order: string[] = [];
      ingressClient.updateIngress.mockImplementation(async (_id: string, opts: any) => {
        order.push(`update:${opts.roomName}`);
        return remoteIngress(opts);
      });
      jest.spyOn(liveKit, 'deleteRoom').mockImplementation(async (streamId) => {
        order.push(`delete:${streamId}`);
        return true;
      });

      await streaming.endStream(CREATOR, 'stream-1');
      expect(order).toEqual([`update:${ingressIdleRoomName(CREATOR)}`, 'delete:stream-1']);
    });

    it('the live still ends when the ingress cannot be unbound', async () => {
      const { streaming } = await createModule(LIVEKIT_ENV);
      ingressRow = { creatorId: CREATOR, ingressId: 'IN_1', streamKey: KEY_1, url: 'u', updatedAt: new Date() };
      ingressClient.updateIngress.mockRejectedValue(new Error('unreachable'));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await expect(streaming.endStream(CREATOR, 'stream-1')).resolves.toMatchObject({ status: 'ENDED' });
    });

    it('recreates the ingress when LiveKit lost it while binding', async () => {
      const { ingress } = await createModule(LIVEKIT_ENV);
      ingressRow = { creatorId: CREATOR, ingressId: 'IN_OLD', streamKey: KEY_1, url: 'u', updatedAt: new Date() };
      ingressClient.updateIngress.mockRejectedValueOnce(Object.assign(new Error('ingress does not exist'), { status: 404 }));
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await ingress.bindToStream(CREATOR, 'stream-1');
      expect(ingressClient.createIngress.mock.calls[0][1].roomName).toBe('live-stream-1');
      expect(ingressRow).toMatchObject({ ingressId: 'IN_1' });
    });

    it('re-binds an OBS live in progress whose ingress is elsewhere when the creator reads it', async () => {
      const { ingress } = await createModule(LIVEKIT_ENV);
      ingressRow = { creatorId: CREATOR, ingressId: 'IN_1', streamKey: KEY_1, url: 'u', updatedAt: new Date() };
      ingressClient.listIngress.mockResolvedValue([remoteIngress({ roomName: ingressIdleRoomName(CREATOR) })]);
      await ingress.getIngress(CREATOR);
      expect(ingressClient.updateIngress).toHaveBeenCalledWith('IN_1', expect.objectContaining({ roomName: 'live-stream-1' }));
    });
  });

  describe('OBS status (webhooks)', () => {
    const bound = async () => {
      const ctx = await createModule(LIVEKIT_ENV);
      ingressRow = { creatorId: CREATOR, ingressId: 'IN_1', streamKey: KEY_1, url: 'u', updatedAt: new Date() };
      await ctx.ingress.bindToStream(CREATOR, 'stream-1');
      ctx.events.length = 0;
      return ctx;
    };

    it('goes offline -> connecting -> live -> offline and announces each change', async () => {
      const { ingress, events, streaming } = await bound();
      expect(ingress.getStreamObsStatus(CREATOR, 'stream-1')).toBe('offline');

      await ingress.handleWebhookEvent({
        event: 'ingress_started',
        ingressInfo: { ingressId: 'IN_1', roomName: 'live-stream-1', state: { status: 1 } },
      } as any);
      expect(ingress.getStreamObsStatus(CREATOR, 'stream-1')).toBe('connecting');

      await ingress.handleWebhookEvent({
        event: 'track_published',
        room: { name: 'live-stream-1' },
        participant: { identity: CREATOR, kind: 1 },
      } as any);
      expect(ingress.getStreamObsStatus(CREATOR, 'stream-1')).toBe('live');
      // The creator's stream data carries it
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValueOnce({
        ...liveStreams['stream-1'],
        visibility: 'PUBLIC',
        isPpv: false,
        streamKey: 'legacy-key',
        creator: { id: CREATOR, username: 'alice', creatorProfile: null },
      });
      await expect(streaming.getStreamById('stream-1', CREATOR)).resolves.toMatchObject({ obsStatus: 'live' });

      await ingress.handleWebhookEvent({
        event: 'ingress_ended',
        ingressInfo: { ingressId: 'IN_1', roomName: 'live-stream-1', state: { status: 4 } },
      } as any);
      expect(ingress.getStreamObsStatus(CREATOR, 'stream-1')).toBe('offline');

      expect(events).toEqual([
        { creatorId: CREATOR, streamId: 'stream-1', status: 'connecting' },
        { creatorId: CREATOR, streamId: 'stream-1', status: 'live' },
        { creatorId: CREATOR, streamId: 'stream-1', status: 'offline' },
      ]);
    });

    it('ignores the events of other ingresses, other participants and older sessions', async () => {
      const { ingress, events } = await bound();
      await ingress.handleWebhookEvent({ event: 'ingress_started', ingressInfo: { ingressId: 'IN_DELETED', roomName: 'live-stream-1' } } as any);
      // A browser publisher (kind STANDARD) is not OBS
      await ingress.handleWebhookEvent({
        event: 'track_published',
        room: { name: 'live-stream-1' },
        participant: { identity: CREATOR, kind: 0 },
      } as any);
      expect(events).toEqual([]);

      await ingress.handleWebhookEvent({
        event: 'track_published',
        room: { name: 'live-stream-1' },
        participant: { identity: CREATOR, kind: 1 },
      } as any);
      // The idle session ended by the binding leaves after the new one started
      await ingress.handleWebhookEvent({
        event: 'participant_left',
        room: { name: ingressIdleRoomName(CREATOR) },
        participant: { identity: CREATOR, kind: 1 },
      } as any);
      expect(ingress.getStreamObsStatus(CREATOR, 'stream-1')).toBe('live');
    });

    it('an OBS push into an ended live is cut: unbound and room deleted', async () => {
      const { ingress, liveKit } = await bound();
      liveStreams['stream-1'].status = 'ENDED';
      const deleteRoom = jest.spyOn(liveKit, 'deleteRoom').mockResolvedValue(true);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await ingress.handleWebhookEvent({
        event: 'track_published',
        room: { name: 'live-stream-1' },
        participant: { identity: CREATOR, kind: 1 },
      } as any);
      expect(ingressClient.updateIngress).toHaveBeenLastCalledWith(
        'IN_1',
        expect.objectContaining({ roomName: ingressIdleRoomName(CREATOR) }),
      );
      expect(deleteRoom).toHaveBeenCalledWith('stream-1');
      expect(ingress.getStreamObsStatus(CREATOR, 'stream-1')).toBe('offline');
    });

    it('reads the status from LiveKit when the webhooks are missing', async () => {
      const { ingress } = await bound();
      ingressClient.listIngress.mockResolvedValue([
        remoteIngress({ roomName: 'live-stream-1', state: { status: 2, tracks: [{ sid: 'TR_1' }] } }),
      ]);
      await expect(ingress.getIngress(CREATOR)).resolves.toMatchObject({ status: 'live', streamId: 'stream-1' });
    });

    it('the webhook controller forwards the events to the ingress service', async () => {
      const { ingress, liveKit } = await bound();
      jest.spyOn(liveKit, 'receiveWebhook').mockResolvedValue({
        event: 'ingress_started',
        ingressInfo: { ingressId: 'IN_1', roomName: 'live-stream-1', state: { status: 1 } },
      } as any);
      const controller = new LiveKitWebhookController(liveKit, ingress);
      await controller.handleWebhook('Bearer x', { rawBody: Buffer.from('{}') } as any);
      expect(ingress.getStreamObsStatus(CREATOR, 'stream-1')).toBe('connecting');
    });

    it('sends obs-status to the creator broadcasting the live only', async () => {
      const { ingress } = await bound();
      const streamingService = {
        getStreamForRealtime: jest.fn().mockResolvedValue({ id: 'stream-1', creatorId: CREATOR, status: 'LIVE', visibility: 'PUBLIC', isPpv: false }),
        getRecentChatMessages: jest.fn().mockResolvedValue([]),
      };
      const emitted: { target: string; event: string; payload: unknown }[] = [];
      const gateway = new StreamingGateway({} as any, {} as any, streamingService as any, undefined, undefined, undefined, ingress);
      gateway.server = {
        to: jest.fn((target: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ target, event, payload }) })),
      } as any;
      gateway.onModuleInit();
      const socket = { id: 'sock-creator', userId: CREATOR, join: jest.fn(), to: jest.fn(() => ({ emit: jest.fn() })) };
      const ack = await gateway.handleStartBroadcast(socket as unknown as AuthenticatedStreamSocket, { streamId: 'stream-1' });
      expect(ack).toMatchObject({ success: true, obsStatus: 'offline' });

      await ingress.handleWebhookEvent({
        event: 'ingress_started',
        ingressInfo: { ingressId: 'IN_1', roomName: 'live-stream-1', state: { status: 1 } },
      } as any);
      gateway.onModuleDestroy();

      const obsEvents = emitted.filter((e) => e.event === 'obs-status');
      expect(obsEvents).toEqual([
        { target: 'sock-creator', event: 'obs-status', payload: { streamId: 'stream-1', status: 'connecting' } },
      ]);
    });
  });

  describe('authorization', () => {
    it('the ingress endpoints are creator-only (RolesGuard + CREATOR role)', () => {
      for (const method of ['getMyIngress', 'resetMyIngressKey'] as const) {
        const handler = StreamingController.prototype[method];
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(RolesGuard);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['CREATOR']);
      }
    });

    it('an endpoint only ever returns the key of the calling creator', async () => {
      const { ingress } = await createModule(LIVEKIT_ENV);
      const controller = new StreamingController({} as any, {} as any, {} as any, ingress);
      await controller.getMyIngress(CREATOR);
      expect(prisma.liveIngress.findUnique).toHaveBeenCalledWith({ where: { creatorId: CREATOR } });
    });

    it('viewers never get the OBS status nor any key in the stream data', async () => {
      const { ingress, streaming } = await createModule(LIVEKIT_ENV);
      await ingress.getIngress(CREATOR);
      prisma.user.findUnique.mockResolvedValue({ role: 'SUBSCRIBER', creatorProfile: null });
      (prisma.liveStream.findUnique as jest.Mock).mockResolvedValueOnce({
        ...liveStreams['stream-1'],
        visibility: 'PUBLIC',
        isPpv: false,
        streamKey: 'legacy-key',
        creator: { id: CREATOR, username: 'alice', creatorProfile: null },
      });
      const view = await streaming.getStreamById('stream-1', 'viewer-1');
      const json = JSON.stringify(view);
      expect(view).not.toHaveProperty('obsStatus');
      expect(json).not.toContain(KEY_1);
      expect(json).not.toContain('legacy-key');
    });
  });
});
