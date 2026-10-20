import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { PrismaService } from '../common/database/prisma.service';
import { StreamingGateway } from '../streaming/streaming.gateway';
import { StreamingService } from '../streaming/streaming.service';
import { INVALID_OVERLAY_TOKEN, OverlaysGateway, TOKEN_ROTATED } from './overlays.gateway';
import { generateOverlayToken, OverlaysService } from './overlays.service';

/**
 * Real socket.io server: what an overlay (OBS browser source) can and cannot do
 */
describe('Overlay sockets (socket.io)', () => {
  let app: INestApplication;
  let url: string;
  let overlaysGateway: OverlaysGateway;
  let streamingGateway: StreamingGateway;
  const sockets: Socket[] = [];

  const token = generateOverlayToken();
  const creator = { id: 'creator-1', username: 'alice', displayName: 'Alice', avatar: null };
  const state = { creator, settings: {}, menu: [], live: null };

  const overlaysService = {
    resolveToken: jest.fn(async (value: unknown) => (value === token ? creator : null)),
    getStateOf: jest.fn(async () => state),
    getCurrentLive: jest.fn(async () => null),
    getStreamCreatorId: jest.fn(async () => 'creator-1'),
  };
  const streamingService = {
    createChatMessage: jest.fn(),
    getStreamForRealtime: jest.fn(),
    checkViewAccess: jest.fn(),
  };
  const jwtService = { verifyAsync: jest.fn(async () => Promise.reject(new Error('invalid signature'))) };
  const prisma = { user: { findUnique: jest.fn() } };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StreamingGateway,
        OverlaysGateway,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: StreamingService, useValue: streamingService },
        { provide: OverlaysService, useValue: overlaysService },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    overlaysGateway = app.get(OverlaysGateway);
    streamingGateway = app.get(StreamingGateway);
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
  });

  afterAll(async () => {
    await app.close();
  });

  const connect = (namespace: string, auth: Record<string, unknown>) => {
    const socket = io(`${url}${namespace}`, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket);
    return socket;
  };

  const connectError = (socket: Socket) =>
    new Promise<string>((resolve) => socket.once('connect_error', (error) => resolve(error.message)));

  const nextEvent = <T = unknown>(socket: Socket, event: string) =>
    new Promise<T>((resolve) => socket.once(event, (payload: T) => resolve(payload)));

  const connectOverlay = async () => {
    const socket = connect('/overlays', { overlayToken: token });
    const ready = await nextEvent(socket, 'overlay-ready');
    return { socket, ready };
  };

  it('connects with the overlay token and receives the state', async () => {
    const { socket, ready } = await connectOverlay();
    expect(socket.connected).toBe(true);
    expect(ready).toEqual(state);
  });

  it.each([
    ['no token', {}],
    ['an unknown token', { overlayToken: generateOverlayToken() }],
    ['a user JWT', { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.sig' }],
  ])('refuses %s', async (_label, auth) => {
    expect(await connectError(connect('/overlays', auth))).toBe(INVALID_OVERLAY_TOKEN);
  });

  it('cannot use the overlay token on the user namespace /streaming', async () => {
    expect(await connectError(connect('/streaming', { token }))).toBe('Unauthorized');
  });

  it('is read-only: write events are never handled nor acknowledged', async () => {
    const { socket } = await connectOverlay();
    for (const [event, payload] of [
      ['send-chat-message', { streamId: 'stream-1', message: 'spam' }],
      ['join-live-stream', { streamId: 'stream-1' }],
      ['send-reaction', { streamId: 'stream-1', emoji: '🔥' }],
      ['update-tip-action', { streamId: 'stream-1', actionId: 'a', status: 'DONE' }],
    ] as const) {
      await expect(socket.timeout(300).emitWithAck(event, payload)).rejects.toThrow();
    }
    expect(streamingService.createChatMessage).not.toHaveBeenCalled();
    expect(streamingService.getStreamForRealtime).not.toHaveBeenCalled();
    expect(socket.connected).toBe(true);
  });

  it('receives the test events and the relayed live events of its creator only', async () => {
    const { socket } = await connectOverlay();
    const tip = nextEvent<{ test?: boolean; amount: number }>(socket, 'tip');
    overlaysGateway.emitTest('creator-1', 'alert');
    expect(await tip).toMatchObject({ test: true, amount: 10 });

    const received: string[] = [];
    socket.on('chat-message', (message: { id: string }) => received.push(message.id));
    // Another creator's live: not relayed
    streamingGateway.streamEvents$.next({ streamId: 'other', creatorId: 'creator-2', event: 'chat-message', payload: { id: 'x' } });
    overlaysService.getCurrentLive.mockResolvedValueOnce({ streamId: 'stream-1' } as never);
    const changed = nextEvent(socket, 'overlay-live-changed');
    streamingGateway.streamEvents$.next({ streamId: 'stream-1', creatorId: 'creator-1', event: 'chat-message', payload: { id: 'm1' } });
    expect(await changed).toEqual({ live: { streamId: 'stream-1' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual(['m1']);
  });

  it('is disconnected with a reason when the token is rotated', async () => {
    const { socket } = await connectOverlay();
    const revoked = nextEvent(socket, 'overlay-revoked');
    const disconnected = nextEvent<string>(socket, 'disconnect');
    overlaysGateway.disconnectCreator('creator-1');
    expect(await revoked).toEqual({ reason: TOKEN_ROTATED });
    expect(await disconnected).toBe('io server disconnect');
  });
});
