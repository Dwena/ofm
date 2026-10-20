import { MESSAGE_METADATA } from '@nestjs/websockets/constants';
import { StreamingGateway, streamRoom } from '../streaming/streaming.gateway';
import { INVALID_OVERLAY_TOKEN, OverlaysGateway, overlayRoom, OverlaySocket, TOKEN_ROTATED } from './overlays.gateway';

type Emitted = { target: string; event: string; payload: any };

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('OverlaysGateway', () => {
  let emitted: Emitted[];
  let overlayEmitted: Emitted[];
  let rooms: Map<string, Set<string>>;
  let streaming: StreamingGateway;
  let gateway: OverlaysGateway;
  let disconnectSockets: jest.Mock;

  const creator = { id: 'creator-1', username: 'alice', displayName: 'Alice', avatar: null };
  const liveState = (streamId: string) => ({
    streamId,
    title: 'Live',
    startedAt: null,
    tipTotal: 0,
    goals: [],
    actions: [],
    messages: [],
  });

  const overlays = {
    resolveToken: jest.fn(),
    getStateOf: jest.fn(),
    getCurrentLive: jest.fn(),
    getStreamCreatorId: jest.fn(),
  };

  const liveTips = { recordTip: jest.fn(), getActionLabels: jest.fn() };
  const streamingService = {
    getStreamForRealtime: jest.fn(),
    checkViewAccess: jest.fn(),
    registerViewer: jest.fn(),
    getRecentChatMessages: jest.fn(),
    createChatMessage: jest.fn(),
    updateViewerStats: jest.fn(),
  };

  const overlaySocket = (id: string, token: unknown): OverlaySocket =>
    ({
      id,
      handshake: { auth: { overlayToken: token }, headers: {}, address: '127.0.0.1' },
      join: jest.fn(async (room: string) => {
        rooms.set(room, new Set([...(rooms.get(room) ?? []), id]));
      }),
      emit: jest.fn((event: string, payload: any) => overlayEmitted.push({ target: id, event, payload })),
      disconnect: jest.fn(),
    }) as unknown as OverlaySocket;

  const toRoom = (target: string, event: string) =>
    overlayEmitted.filter((e) => e.target === target && e.event === event).map((e) => e.payload);

  beforeEach(() => {
    jest.clearAllMocks();
    emitted = [];
    overlayEmitted = [];
    rooms = new Map();
    disconnectSockets = jest.fn();

    streaming = new StreamingGateway(
      { user: { findUnique: jest.fn() } } as any,
      { verifyAsync: jest.fn() } as any,
      streamingService as any,
      undefined,
      liveTips as any,
    );
    streaming.server = {
      to: jest.fn((target: string) => ({
        emit: (event: string, payload: any) => emitted.push({ target, event, payload }),
      })),
      in: jest.fn(() => ({ socketsLeave: jest.fn() })),
    } as any;

    gateway = new OverlaysGateway(overlays as any, streaming);
    gateway.server = {
      to: jest.fn((target: string) => ({
        emit: (event: string, payload: any) => overlayEmitted.push({ target, event, payload }),
      })),
      in: jest.fn(() => ({ disconnectSockets })),
      adapter: { rooms },
    } as any;
    gateway.onModuleInit();

    overlays.resolveToken.mockImplementation(async (token: string) => (token === 'good-token' ? creator : null));
    overlays.getStateOf.mockResolvedValue({ creator, settings: {}, menu: [], live: liveState('stream-1') });
    overlays.getCurrentLive.mockResolvedValue(liveState('stream-1'));
    streamingService.getStreamForRealtime.mockResolvedValue({ id: 'stream-1', creatorId: 'creator-1', status: 'LIVE' });
    streamingService.checkViewAccess.mockResolvedValue({ allowed: true, isCreator: false });
    streamingService.getRecentChatMessages.mockResolvedValue([]);
    streamingService.registerViewer.mockResolvedValue({});
    streamingService.updateViewerStats.mockResolvedValue(undefined);
  });

  afterEach(() => {
    gateway.onModuleDestroy();
    streaming.onModuleDestroy();
  });

  const connectOverlay = async (id = 'overlay-1') => {
    const socket = overlaySocket(id, 'good-token');
    expect(await gateway.authenticate(socket)).toBe(true);
    await gateway.handleConnection(socket);
    return socket;
  };

  describe('authentication', () => {
    it('accepts a valid overlay token, joins the creator room and sends the state', async () => {
      const socket = await connectOverlay();
      expect(socket.join).toHaveBeenCalledWith(overlayRoom('creator-1'));
      expect(toRoom('overlay-1', 'overlay-ready')).toEqual([
        { creator, settings: {}, menu: [], live: liveState('stream-1') },
      ]);
      expect(gateway.hasOverlays('creator-1')).toBe(true);
    });

    it.each([['missing', undefined], ['unknown', 'bad-token'], ['a user JWT', 'eyJhbGciOiJIUzI1NiJ9.e30.x']])(
      'refuses a %s token',
      async (_label, token) => {
        const socket = overlaySocket('overlay-x', token);
        expect(await gateway.authenticate(socket)).toBe(false);
        await gateway.handleConnection(socket);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(socket.join).not.toHaveBeenCalled();
      },
    );

    it('rejects the connection in the middleware with INVALID_OVERLAY_TOKEN', async () => {
      let middleware: (socket: any, next: (error?: Error) => void) => void = () => undefined;
      gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as any);
      const error = await new Promise<Error | undefined>((resolve) => middleware(overlaySocket('x', 'bad-token'), resolve));
      expect(error?.message).toBe(INVALID_OVERLAY_TOKEN);
      const ok = await new Promise<Error | undefined>((resolve) => middleware(overlaySocket('y', 'good-token'), resolve));
      expect(ok).toBeUndefined();
    });

    it('has no message handler: an overlay socket cannot send anything', () => {
      const handlersOf = (cls: { prototype: object }) => {
        const proto = cls.prototype as Record<string, unknown>;
        return Object.getOwnPropertyNames(proto).filter(
          (name) => typeof proto[name] === 'function' && Reflect.getMetadata(MESSAGE_METADATA, proto[name] as object),
        );
      };
      // Sanity check of the lookup: the streaming gateway does have its write handlers
      expect(handlersOf(StreamingGateway)).toEqual(expect.arrayContaining(['handleChatMessage', 'handleReaction']));
      expect(handlersOf(OverlaysGateway)).toEqual([]);
    });
  });

  describe('fan-out of the live events', () => {
    it('relays the chat, tip, goals and request events of the current live to the overlay room', async () => {
      await connectOverlay();
      liveTips.recordTip.mockResolvedValue({
        creatorId: 'creator-1',
        message: {
          id: 'msg-1',
          senderId: 'fan-1',
          message: 'Bravo',
          createdAt: new Date('2026-10-20T10:00:00Z'),
          type: 'TIP',
          tipAmount: 20,
          sender: { username: 'fan', displayName: 'Fan', avatar: null },
        },
        action: { id: 'action-1', label: 'Chanson', status: 'PENDING' },
        total: 120,
        goals: [{ id: 'goal-1', amount: 100 }],
        reachedGoals: [{ id: 'goal-1', amount: 100 }],
        systemMessages: [],
      });

      await streaming.notifyTip({
        streamId: 'stream-1',
        creatorId: 'creator-1',
        transactionId: 'tx-1',
        amount: 20,
        message: 'Bravo',
        menuItemLabel: 'Chanson',
        fromUser: { id: 'fan-1', username: 'fan', displayName: 'Fan', avatar: null },
        completedAt: new Date(),
      } as any);
      await flush();

      const room = overlayRoom('creator-1');
      const events = overlayEmitted.filter((e) => e.target === room).map((e) => e.event);
      expect(events).toEqual(['chat-message', 'tip', 'tip-goal-progress', 'tip-action-created', 'tip-goal-reached']);
      // The same payloads as the stream room
      for (const event of events) {
        expect(toRoom(room, event)).toEqual(emitted.filter((e) => e.target === streamRoom('stream-1') && e.event === event).map((e) => e.payload));
      }
      expect(toRoom(room, 'tip')[0]).toMatchObject({ amount: 20, menuItemLabel: 'Chanson', fromUser: { username: 'fan' } });
    });

    it('relays chat messages sent through the gateway and viewer counts', async () => {
      await connectOverlay();
      const viewer = {
        id: 'viewer-socket',
        userId: 'fan-1',
        user: { id: 'fan-1', username: 'fan' },
        handshake: { auth: {}, headers: {} },
        join: jest.fn(),
        leave: jest.fn(),
      } as any;
      await streaming.handleJoinStream(viewer, { streamId: 'stream-1' });
      streamingService.createChatMessage.mockResolvedValue({
        id: 'msg-2',
        senderId: 'fan-1',
        message: 'Coucou',
        createdAt: new Date(),
        sender: { username: 'fan' },
      });
      await streaming.handleChatMessage(viewer, { streamId: 'stream-1', message: 'Coucou' });
      await flush();

      const room = overlayRoom('creator-1');
      expect(toRoom(room, 'viewer-count')).toEqual([1]);
      expect(toRoom(room, 'chat-message')).toEqual([expect.objectContaining({ id: 'msg-2', message: 'Coucou' })]);
    });

    it('does nothing when the creator has no overlay connected', async () => {
      streaming.notifyTipGoalsUpdated({ streamId: 'stream-1', total: 0, goals: [] });
      await flush();
      expect(overlayEmitted).toEqual([]);
    });

    it('looks up the creator of an event that does not carry it (cached afterwards)', async () => {
      await connectOverlay();
      overlays.getStreamCreatorId.mockResolvedValue('creator-1');
      streaming.notifyTipGoalsUpdated({ streamId: 'stream-1', total: 10, goals: [] });
      streaming.notifyTipGoalUpdated({ streamId: 'stream-1', goal: { id: 'g' } as any });
      await flush();
      await flush();
      expect(toRoom(overlayRoom('creator-1'), 'tip-goals-updated')).toEqual([{ streamId: 'stream-1', total: 10, goals: [] }]);
      expect(toRoom(overlayRoom('creator-1'), 'tip-goal-updated')).toHaveLength(1);
    });

    it('never relays signaling or moderation-only events, nor other creators’ events', async () => {
      await connectOverlay();
      await gateway.relay({ streamId: 'stream-1', creatorId: 'creator-1', event: 'offer', payload: {} });
      await gateway.relay({ streamId: 'stream-9', creatorId: 'creator-2', event: 'chat-message', payload: {} });
      expect(overlayEmitted.filter((e) => e.target !== 'overlay-1')).toEqual([]);
    });

    it('switches to a new live when the creator starts one, and to none when it ends', async () => {
      await connectOverlay();
      overlays.getCurrentLive.mockResolvedValueOnce(liveState('stream-2'));
      streaming.notifyStreamStarted({ id: 'stream-2', creatorId: 'creator-1', status: 'LIVE' });
      await flush();
      expect(toRoom(overlayRoom('creator-1'), 'overlay-live-changed')).toEqual([{ live: liveState('stream-2') }]);

      overlays.getCurrentLive.mockResolvedValueOnce(null);
      streaming.notifyStreamEnded('stream-2');
      await flush();
      expect(toRoom(overlayRoom('creator-1'), 'stream-ended')).toEqual([{ streamId: 'stream-2' }]);
      expect(toRoom(overlayRoom('creator-1'), 'overlay-live-changed')).toEqual([
        { live: liveState('stream-2') },
        { live: null },
      ]);
    });

    it('switches to a live started elsewhere when one of its events arrives', async () => {
      overlays.getStateOf.mockResolvedValue({ creator, settings: {}, menu: [], live: null });
      await connectOverlay();
      overlays.getCurrentLive.mockResolvedValueOnce(liveState('stream-3'));
      await gateway.relay({ streamId: 'stream-3', creatorId: 'creator-1', event: 'chat-message', payload: { id: 'm' } });
      expect(overlayEmitted.filter((e) => e.target === overlayRoom('creator-1')).map((e) => e.event)).toEqual([
        'overlay-live-changed',
        'chat-message',
      ]);
    });

    it('relays tip menu updates (active items only)', async () => {
      await connectOverlay();
      streaming.notifyTipMenuUpdated('creator-1', [
        { id: 'a', isActive: true },
        { id: 'b', isActive: false },
      ] as any);
      await flush();
      expect(toRoom(overlayRoom('creator-1'), 'tip-menu-updated')).toEqual([{ items: [{ id: 'a', isActive: true }] }]);
      // Not sent to any stream room
      expect(emitted.filter((e) => e.event === 'tip-menu-updated')).toEqual([]);
    });
  });

  describe('test events', () => {
    it.each([
      ['alert', ['tip']],
      ['menu-request', ['tip', 'tip-action-created']],
      ['goal-reached', ['tip-goal-reached']],
      ['chat', ['chat-message']],
    ] as const)('%s is sent only to the creator overlay room, flagged test', (kind, events) => {
      gateway.emitTest('creator-1', kind, [
        { id: 'item-1', label: 'Danse', emoji: '💃', amount: 30, description: null, position: 0, isActive: true },
      ]);
      expect(overlayEmitted.map((e) => e.target)).toEqual(events.map(() => overlayRoom('creator-1')));
      expect(overlayEmitted.map((e) => e.event)).toEqual(events);
      overlayEmitted.forEach((e) => expect(e.payload.test).toBe(true));
      // Never to a stream room (viewers, chat)
      expect(emitted).toEqual([]);
      expect(streamingService.createChatMessage).not.toHaveBeenCalled();
      if (kind === 'menu-request') {
        expect(overlayEmitted[0].payload).toMatchObject({ amount: 30, menuItemLabel: '💃 Danse' });
      }
    });
  });

  describe('settings and token rotation', () => {
    it('pushes saved settings to the overlay room', () => {
      gateway.notifySettingsUpdated('creator-1', 'CHAT', { maxMessages: 3 } as any);
      expect(toRoom(overlayRoom('creator-1'), 'settings-updated')).toEqual([{ widget: 'CHAT', settings: { maxMessages: 3 } }]);
    });

    it('tells the overlays why, then disconnects them on rotation', () => {
      gateway.disconnectCreator('creator-1');
      expect(toRoom(overlayRoom('creator-1'), 'overlay-revoked')).toEqual([{ reason: TOKEN_ROTATED }]);
      expect(gateway.server.in).toHaveBeenCalledWith(overlayRoom('creator-1'));
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });
  });
});
