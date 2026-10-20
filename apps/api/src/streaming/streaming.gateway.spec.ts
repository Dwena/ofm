import {
  StreamingGateway,
  AuthenticatedStreamSocket,
  streamRoom,
  VIEWER_STATS_INTERVAL_MS,
} from './streaming.gateway';

type Emitted = { target: string; event: string; payload: any };

describe('StreamingGateway', () => {
  let gateway: StreamingGateway;
  let emitted: Emitted[];

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockJwtService = {
    verifyAsync: jest.fn(),
  };

  const mockStreamingService = {
    getStreamForRealtime: jest.fn(),
    checkViewAccess: jest.fn(),
    registerViewer: jest.fn(),
    markViewerLeft: jest.fn(),
    updateViewerStats: jest.fn(),
    getRecentChatMessages: jest.fn(),
    createChatMessage: jest.fn(),
    deleteChatMessage: jest.fn(),
  };

  const liveStream = {
    id: 'stream-1',
    creatorId: 'creator-1',
    visibility: 'SUBSCRIBERS_ONLY',
    isPpv: false,
    status: 'LIVE',
  };

  const createSocket = (id: string, userId?: string): AuthenticatedStreamSocket =>
    ({
      id,
      userId,
      user: userId ? { id: userId, username: `${userId}-name` } : undefined,
      handshake: { auth: {}, headers: {} },
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      to: jest.fn((target: string) => ({
        emit: (event: string, payload: any) => emitted.push({ target: `except:${id}:${target}`, event, payload }),
      })),
    }) as unknown as AuthenticatedStreamSocket;

  const eventsTo = (target: string, event: string) =>
    emitted.filter((e) => e.target === target && e.event === event).map((e) => e.payload);

  beforeEach(() => {
    jest.clearAllMocks();
    emitted = [];

    gateway = new StreamingGateway(mockPrismaService as any, mockJwtService as any, mockStreamingService as any);
    gateway.server = {
      to: jest.fn((target: string) => ({
        emit: (event: string, payload: any) => emitted.push({ target, event, payload }),
      })),
      in: jest.fn(() => ({ socketsLeave: jest.fn() })),
    } as any;

    mockStreamingService.getStreamForRealtime.mockResolvedValue(liveStream);
    mockStreamingService.checkViewAccess.mockImplementation(async (userId: string) => ({
      allowed: true,
      isCreator: userId === liveStream.creatorId,
    }));
    mockStreamingService.getRecentChatMessages.mockResolvedValue([]);
    mockStreamingService.registerViewer.mockResolvedValue({ firstView: true });
    mockStreamingService.markViewerLeft.mockResolvedValue(true);
    mockStreamingService.updateViewerStats.mockResolvedValue(undefined);
  });

  afterEach(() => {
    gateway.onModuleDestroy();
  });

  describe('viewer stats throttling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-20T10:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('emits every count right away but writes the stats at most every interval, keeping the peak', async () => {
      await gateway.handleJoinStream(createSocket('v1', 'user-1'), { streamId: 'stream-1' });
      await gateway.handleJoinStream(createSocket('v2', 'user-2'), { streamId: 'stream-1' });
      await gateway.handleJoinStream(createSocket('v3', 'user-3'), { streamId: 'stream-1' });
      await gateway.handleLeaveStream(createSocket('v3', 'user-3'), { streamId: 'stream-1' });

      expect(eventsTo(streamRoom('stream-1'), 'viewer-count')).toEqual([1, 2, 3, 2]);
      // Leading write only
      expect(mockStreamingService.updateViewerStats).toHaveBeenCalledTimes(1);
      expect(mockStreamingService.updateViewerStats).toHaveBeenLastCalledWith('stream-1', 1, 1);

      jest.advanceTimersByTime(VIEWER_STATS_INTERVAL_MS);
      expect(mockStreamingService.updateViewerStats).toHaveBeenCalledTimes(2);
      // Current count 2, peak 3 reached between the writes
      expect(mockStreamingService.updateViewerStats).toHaveBeenLastCalledWith('stream-1', 2, 3);
    });

    it('flushes the pending stats when the broadcaster leaves', async () => {
      const broadcaster = createSocket('b1', 'creator-1');
      await gateway.handleStartBroadcast(broadcaster, { streamId: 'stream-1' });
      await gateway.handleJoinStream(createSocket('v1', 'user-1'), { streamId: 'stream-1' });
      await gateway.handleJoinStream(createSocket('v2', 'user-2'), { streamId: 'stream-1' });
      expect(mockStreamingService.updateViewerStats).toHaveBeenCalledTimes(1);

      await gateway.handleDisconnect(broadcaster);
      expect(mockStreamingService.updateViewerStats).toHaveBeenCalledTimes(2);
      expect(mockStreamingService.updateViewerStats).toHaveBeenLastCalledWith('stream-1', 2, 2);

      // Nothing left to write afterwards
      jest.advanceTimersByTime(VIEWER_STATS_INTERVAL_MS * 2);
      expect(mockStreamingService.updateViewerStats).toHaveBeenCalledTimes(2);
    });

    it('flushes on demand before a stream ends', async () => {
      await gateway.handleJoinStream(createSocket('v1', 'user-1'), { streamId: 'stream-1' });
      await gateway.handleJoinStream(createSocket('v2', 'user-2'), { streamId: 'stream-1' });
      await gateway.flushViewerStats('stream-1');
      expect(mockStreamingService.updateViewerStats).toHaveBeenLastCalledWith('stream-1', 2, 2);
      await gateway.flushViewerStats('stream-1');
      expect(mockStreamingService.updateViewerStats).toHaveBeenCalledTimes(2);
    });

    it('does not fail the join when the stats write fails', async () => {
      mockStreamingService.updateViewerStats.mockRejectedValue(new Error('db down'));
      const result = await gateway.handleJoinStream(createSocket('v1', 'user-1'), { streamId: 'stream-1' });
      expect(result).toMatchObject({ success: true, viewerCount: 1 });
    });
  });

  describe('handleConnection', () => {
    it('disconnects sockets without a token', async () => {
      const socket = createSocket('s1');
      await gateway.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('disconnects sockets with an invalid token', async () => {
      const socket = createSocket('s1');
      socket.handshake.auth = { token: 'bad' };
      mockJwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      await gateway.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('disconnects banned users', async () => {
      const socket = createSocket('s1');
      socket.handshake.auth = { token: 'good' };
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'u', status: 'BANNED' });
      await gateway.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('authenticates valid tokens', async () => {
      const socket = createSocket('s1');
      socket.handshake.auth = { token: 'good' };
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'alice',
        displayName: 'Alice',
        avatar: null,
        status: 'ACTIVE',
      });
      await gateway.handleConnection(socket);
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.userId).toBe('user-1');
      expect(socket.user?.username).toBe('alice');
    });
  });

  describe('afterInit (auth middleware)', () => {
    const setup = () => {
      let middleware: (socket: any, next: (err?: Error) => void) => void = () => undefined;
      gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as any);
      const run = (socket: AuthenticatedStreamSocket) =>
        new Promise<Error | undefined>((resolve) => middleware(socket, resolve));
      return run;
    };

    it('authenticates the socket before the client is connected', async () => {
      const run = setup();
      const socket = createSocket('s1');
      socket.handshake.auth = { token: 'good' };
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'alice', status: 'ACTIVE' });

      expect(await run(socket)).toBeUndefined();
      expect(socket.userId).toBe('user-1');

      // handleConnection does not re-check an authenticated socket
      await gateway.handleConnection(socket);
      expect(mockJwtService.verifyAsync).toHaveBeenCalledTimes(1);
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('refuses the connection without a valid token', async () => {
      const run = setup();
      const error = await run(createSocket('s1'));
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe('Unauthorized');
    });
  });

  describe('join-live-stream', () => {
    it('rejects unauthenticated sockets', async () => {
      const result = await gateway.handleJoinStream(createSocket('s1'), { streamId: 'stream-1' });
      expect(result).toEqual({ error: 'Unauthorized' });
    });

    it('rejects streams that are not live', async () => {
      mockStreamingService.getStreamForRealtime.mockResolvedValue({ ...liveStream, status: 'SCHEDULED' });
      const result = await gateway.handleJoinStream(createSocket('s1', 'user-1'), { streamId: 'stream-1' });
      expect(result).toMatchObject({ reason: 'NOT_LIVE' });
    });

    it('enforces access rules', async () => {
      mockStreamingService.checkViewAccess.mockResolvedValue({
        allowed: false,
        isCreator: false,
        reason: 'SUBSCRIPTION_REQUIRED',
      });
      const socket = createSocket('s1', 'user-1');
      const result = await gateway.handleJoinStream(socket, { streamId: 'stream-1' });
      expect(result).toEqual({ error: 'Forbidden', reason: 'SUBSCRIPTION_REQUIRED' });
      expect(socket.join).not.toHaveBeenCalled();
      expect(mockStreamingService.registerViewer).not.toHaveBeenCalled();
    });

    it('joins the room, records the viewer and broadcasts the count', async () => {
      const socket = createSocket('s1', 'user-1');
      const result = await gateway.handleJoinStream(socket, { streamId: 'stream-1' });

      expect(result).toMatchObject({ success: true, viewerCount: 1, broadcasterOnline: false });
      expect(socket.join).toHaveBeenCalledWith(streamRoom('stream-1'));
      expect(mockStreamingService.registerViewer).toHaveBeenCalledWith('stream-1', 'user-1');
      expect(eventsTo(streamRoom('stream-1'), 'viewer-count')).toEqual([1]);
      expect(mockStreamingService.updateViewerStats).toHaveBeenCalledWith('stream-1', 1, 1);
    });

    it('counts a user with several tabs once', async () => {
      await gateway.handleJoinStream(createSocket('s1', 'user-1'), { streamId: 'stream-1' });
      const result = await gateway.handleJoinStream(createSocket('s2', 'user-1'), { streamId: 'stream-1' });

      expect(result).toMatchObject({ viewerCount: 1 });
      expect(mockStreamingService.registerViewer).toHaveBeenCalledTimes(1);
      expect(gateway.getViewerCount('stream-1')).toBe(1);
    });
  });

  describe('start-broadcast', () => {
    it('only lets the creator broadcast', async () => {
      const result = await gateway.handleStartBroadcast(createSocket('s1', 'user-1'), { streamId: 'stream-1' });
      expect(result).toMatchObject({ reason: 'NOT_CREATOR' });
    });

    it('requires the stream to be live', async () => {
      mockStreamingService.getStreamForRealtime.mockResolvedValue({ ...liveStream, status: 'ENDED' });
      const result = await gateway.handleStartBroadcast(createSocket('b1', 'creator-1'), { streamId: 'stream-1' });
      expect(result).toMatchObject({ reason: 'NOT_LIVE' });
    });

    it('registers the broadcaster and tells waiting viewers', async () => {
      await gateway.handleJoinStream(createSocket('v1', 'user-1'), { streamId: 'stream-1' });
      const broadcaster = createSocket('b1', 'creator-1');

      const result = await gateway.handleStartBroadcast(broadcaster, { streamId: 'stream-1' });
      expect(result).toMatchObject({ success: true, viewerCount: 1 });
      expect(eventsTo(`except:b1:${streamRoom('stream-1')}`, 'broadcaster-ready')).toEqual([
        { streamId: 'stream-1' },
      ]);
    });
  });

  describe('signaling', () => {
    let viewer: AuthenticatedStreamSocket;
    let broadcaster: AuthenticatedStreamSocket;

    beforeEach(async () => {
      viewer = createSocket('v1', 'user-1');
      broadcaster = createSocket('b1', 'creator-1');
      await gateway.handleJoinStream(viewer, { streamId: 'stream-1' });
      await gateway.handleStartBroadcast(broadcaster, { streamId: 'stream-1' });
      emitted = [];
    });

    it('forwards offer requests to the broadcaster', () => {
      expect(gateway.handleRequestOffer(viewer, { streamId: 'stream-1' })).toEqual({ success: true });
      expect(eventsTo('b1', 'viewer-joined')).toEqual([{ streamId: 'stream-1', viewerId: 'v1', userId: 'user-1' }]);
    });

    it('relays ICE restart requests', () => {
      gateway.handleRequestOffer(viewer, { streamId: 'stream-1', iceRestart: true });
      gateway.handleRequestOffer(viewer, { streamId: 'stream-1', iceRestart: 'yes' as any });
      expect(eventsTo('b1', 'viewer-joined')).toEqual([
        { streamId: 'stream-1', viewerId: 'v1', userId: 'user-1', iceRestart: true },
        { streamId: 'stream-1', viewerId: 'v1', userId: 'user-1' },
      ]);
    });

    describe('set-viewer-quality', () => {
      it('relays the data saver choice to the broadcaster', () => {
        expect(gateway.handleSetViewerQuality(viewer, { streamId: 'stream-1', mode: 'low' })).toEqual({
          success: true,
          mode: 'low',
        });
        gateway.handleSetViewerQuality(viewer, { streamId: 'stream-1', mode: 'auto' });
        expect(eventsTo('b1', 'viewer-quality')).toEqual([
          { streamId: 'stream-1', viewerId: 'v1', mode: 'low' },
          { streamId: 'stream-1', viewerId: 'v1', mode: 'auto' },
        ]);
      });

      it('rejects unknown modes', () => {
        const result = gateway.handleSetViewerQuality(viewer, { streamId: 'stream-1', mode: 'ultra' as any });
        expect(result).toEqual({ error: 'Invalid quality mode' });
        expect(emitted).toHaveLength(0);
      });

      it('rejects sockets that are not watching the stream', () => {
        const outsider = createSocket('x1', 'user-2');
        expect(gateway.handleSetViewerQuality(outsider, { streamId: 'stream-1', mode: 'low' })).toHaveProperty('error');
        // The broadcaster is not a viewer of its own stream
        expect(gateway.handleSetViewerQuality(broadcaster, { streamId: 'stream-1', mode: 'low' })).toHaveProperty(
          'error',
        );
        expect(gateway.handleSetViewerQuality(viewer, { streamId: 'other', mode: 'low' })).toHaveProperty('error');
        expect(gateway.handleSetViewerQuality(viewer, undefined as any)).toHaveProperty('error');
        expect(emitted).toHaveLength(0);
      });

      it('reports when the broadcaster is offline', async () => {
        await gateway.handleDisconnect(broadcaster);
        emitted = [];
        expect(gateway.handleSetViewerQuality(viewer, { streamId: 'stream-1', mode: 'low' })).toMatchObject({
          reason: 'BROADCASTER_OFFLINE',
        });
        expect(emitted).toHaveLength(0);
      });
    });

    it('reports when the broadcaster is offline', async () => {
      await gateway.handleDisconnect(broadcaster);
      expect(gateway.handleRequestOffer(viewer, { streamId: 'stream-1' })).toMatchObject({
        reason: 'BROADCASTER_OFFLINE',
      });
      expect(eventsTo(streamRoom('stream-1'), 'broadcaster-disconnected')).toEqual([{ streamId: 'stream-1' }]);
    });

    it('rejects offer requests from sockets that did not join', () => {
      const outsider = createSocket('x1', 'user-2');
      expect(gateway.handleRequestOffer(outsider, { streamId: 'stream-1' })).toHaveProperty('error');
    });

    it('relays the offer from the broadcaster to the viewer', () => {
      const offer = { type: 'offer', sdp: 'v=0' };
      expect(gateway.handleOffer(broadcaster, { streamId: 'stream-1', viewerId: 'v1', offer })).toEqual({
        success: true,
      });
      expect(eventsTo('v1', 'offer')).toEqual([{ streamId: 'stream-1', offer }]);
    });

    it('relays the negotiation session id with offers and answers', () => {
      gateway.handleOffer(broadcaster, { streamId: 'stream-1', viewerId: 'v1', offer: { type: 'offer' }, sessionId: 'n1' });
      gateway.handleAnswer(viewer, { streamId: 'stream-1', answer: { type: 'answer' }, sessionId: 'n1' });
      expect(eventsTo('v1', 'offer')[0].sessionId).toBe('n1');
      expect(eventsTo('b1', 'answer')[0].sessionId).toBe('n1');
    });

    it('does not let viewers send offers', () => {
      const result = gateway.handleOffer(viewer, { streamId: 'stream-1', viewerId: 'v1', offer: {} });
      expect(result).toHaveProperty('error');
      expect(emitted).toHaveLength(0);
    });

    it('rejects offers to unknown viewers', () => {
      const result = gateway.handleOffer(broadcaster, { streamId: 'stream-1', viewerId: 'nope', offer: {} });
      expect(result).toEqual({ error: 'Unknown viewer' });
    });

    it('relays the answer from the viewer to the broadcaster', () => {
      const answer = { type: 'answer', sdp: 'v=0' };
      expect(gateway.handleAnswer(viewer, { streamId: 'stream-1', answer })).toEqual({ success: true });
      expect(eventsTo('b1', 'answer')).toEqual([{ streamId: 'stream-1', viewerId: 'v1', answer }]);
    });

    it('relays ICE candidates in both directions', () => {
      const candidate = { candidate: 'candidate:1', sdpMid: '0' };

      gateway.handleIceCandidate(viewer, { streamId: 'stream-1', candidate });
      expect(eventsTo('b1', 'ice-candidate')).toEqual([{ streamId: 'stream-1', viewerId: 'v1', candidate }]);

      gateway.handleIceCandidate(broadcaster, { streamId: 'stream-1', viewerId: 'v1', candidate });
      expect(eventsTo('v1', 'ice-candidate')).toEqual([{ streamId: 'stream-1', candidate }]);
    });

    it('notifies the broadcaster when a viewer leaves and updates the count', async () => {
      await gateway.handleLeaveStream(viewer, { streamId: 'stream-1' });
      expect(eventsTo('b1', 'viewer-left')).toEqual([{ streamId: 'stream-1', viewerId: 'v1' }]);
      expect(mockStreamingService.markViewerLeft).toHaveBeenCalledWith('stream-1', 'user-1');
      expect(eventsTo(streamRoom('stream-1'), 'viewer-count')).toEqual([0]);
    });

    it('keeps the viewer session open while another tab is watching', async () => {
      const secondTab = createSocket('v2', 'user-1');
      await gateway.handleJoinStream(secondTab, { streamId: 'stream-1' });
      await gateway.handleDisconnect(viewer);
      expect(mockStreamingService.markViewerLeft).not.toHaveBeenCalled();
      expect(gateway.getViewerCount('stream-1')).toBe(1);
    });
  });

  describe('chat and reactions', () => {
    let viewer: AuthenticatedStreamSocket;

    beforeEach(async () => {
      viewer = createSocket('v1', 'user-1');
      await gateway.handleJoinStream(viewer, { streamId: 'stream-1' });
      emitted = [];
    });

    it('persists and broadcasts chat messages', async () => {
      mockStreamingService.createChatMessage.mockResolvedValue({
        id: 'msg-1',
        senderId: 'user-1',
        message: 'Bonjour',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        sender: { username: 'alice', displayName: 'Alice', avatar: null },
      });

      const result = await gateway.handleChatMessage(viewer, { streamId: 'stream-1', message: 'Bonjour' });
      expect(result).toEqual({ success: true, messageId: 'msg-1' });
      expect(mockStreamingService.createChatMessage).toHaveBeenCalledWith('stream-1', 'user-1', 'Bonjour');
      expect(eventsTo(streamRoom('stream-1'), 'chat-message')).toEqual([
        {
          id: 'msg-1',
          userId: 'user-1',
          username: 'alice',
          displayName: 'Alice',
          avatar: null,
          message: 'Bonjour',
          timestamp: '2026-01-01T00:00:00.000Z',
          type: 'MESSAGE',
          isCreator: false,
        },
      ]);
    });

    it('rate limits chat messages', async () => {
      mockStreamingService.createChatMessage.mockResolvedValue({
        id: 'msg-1',
        senderId: 'user-1',
        message: 'a',
        createdAt: new Date(),
      });
      await gateway.handleChatMessage(viewer, { streamId: 'stream-1', message: 'a' });
      const second = await gateway.handleChatMessage(viewer, { streamId: 'stream-1', message: 'b' });
      expect(second).toMatchObject({ reason: 'RATE_LIMITED' });
    });

    describe('moderation', () => {
      let broadcaster: AuthenticatedStreamSocket;

      beforeEach(async () => {
        broadcaster = createSocket('b1', 'creator-1');
        await gateway.handleStartBroadcast(broadcaster, { streamId: 'stream-1' });
        emitted = [];
      });

      it('lets the creator delete a chat message', async () => {
        mockStreamingService.deleteChatMessage.mockResolvedValue(true);
        const result = await gateway.handleDeleteChatMessage(broadcaster, { streamId: 'stream-1', messageId: 'msg-1' });
        expect(result).toEqual({ success: true });
        expect(mockStreamingService.deleteChatMessage).toHaveBeenCalledWith('stream-1', 'msg-1');
        expect(eventsTo(streamRoom('stream-1'), 'chat-message-deleted')).toEqual([
          { streamId: 'stream-1', messageId: 'msg-1' },
        ]);
      });

      it('reports unknown messages', async () => {
        mockStreamingService.deleteChatMessage.mockResolvedValue(false);
        const result = await gateway.handleDeleteChatMessage(broadcaster, { streamId: 'stream-1', messageId: 'nope' });
        expect(result).toMatchObject({ reason: 'NOT_FOUND' });
        expect(eventsTo(streamRoom('stream-1'), 'chat-message-deleted')).toHaveLength(0);
      });

      it('forbids viewers from moderating', async () => {
        const deleted = await gateway.handleDeleteChatMessage(viewer, { streamId: 'stream-1', messageId: 'msg-1' });
        const muted = gateway.handleMuteViewer(viewer, { streamId: 'stream-1', userId: 'user-2' });
        expect(deleted).toMatchObject({ reason: 'NOT_CREATOR' });
        expect(muted).toMatchObject({ reason: 'NOT_CREATOR' });
        expect(mockStreamingService.deleteChatMessage).not.toHaveBeenCalled();
      });

      it('mutes and unmutes a viewer in the chat', async () => {
        expect(gateway.handleMuteViewer(broadcaster, { streamId: 'stream-1', userId: 'user-1' })).toEqual({
          success: true,
          muted: true,
        });
        expect(eventsTo(streamRoom('stream-1'), 'viewer-muted')).toEqual([
          { streamId: 'stream-1', userId: 'user-1', muted: true },
        ]);

        const refused = await gateway.handleChatMessage(viewer, { streamId: 'stream-1', message: 'spam' });
        expect(refused).toMatchObject({ reason: 'MUTED' });
        expect(mockStreamingService.createChatMessage).not.toHaveBeenCalled();

        // A muted viewer who rejoins is told so
        const rejoin = await gateway.handleJoinStream(createSocket('v2', 'user-1'), { streamId: 'stream-1' });
        expect(rejoin).toMatchObject({ muted: true });

        gateway.handleMuteViewer(broadcaster, { streamId: 'stream-1', userId: 'user-1', muted: false });
        mockStreamingService.createChatMessage.mockResolvedValue({
          id: 'msg-2',
          senderId: 'user-1',
          message: 'ok',
          createdAt: new Date(),
        });
        const allowed = await gateway.handleChatMessage(viewer, { streamId: 'stream-1', message: 'ok' });
        expect(allowed).toMatchObject({ success: true });
      });

      it('cannot mute the creator', () => {
        expect(gateway.handleMuteViewer(broadcaster, { streamId: 'stream-1', userId: 'creator-1' })).toHaveProperty(
          'error',
        );
      });

      it('forgets mutes once the stream ends', async () => {
        gateway.handleMuteViewer(broadcaster, { streamId: 'stream-1', userId: 'user-1' });
        gateway.notifyStreamEnded('stream-1');
        const rejoin = await gateway.handleJoinStream(createSocket('v3', 'user-1'), { streamId: 'stream-1' });
        expect(rejoin).toMatchObject({ muted: false });
      });
    });

    it('rate limits chat messages per user, across tabs', async () => {
      mockStreamingService.createChatMessage.mockResolvedValue({
        id: 'msg-1',
        senderId: 'user-1',
        message: 'a',
        createdAt: new Date(),
      });
      const secondTab = createSocket('v2', 'user-1');
      await gateway.handleJoinStream(secondTab, { streamId: 'stream-1' });
      await gateway.handleChatMessage(viewer, { streamId: 'stream-1', message: 'a' });
      const fromOtherTab = await gateway.handleChatMessage(secondTab, { streamId: 'stream-1', message: 'b' });
      expect(fromOtherTab).toMatchObject({ reason: 'RATE_LIMITED' });

      // Reconnecting (new socket id) does not reset the limit either
      await gateway.handleDisconnect(viewer);
      const reconnected = createSocket('v3', 'user-1');
      await gateway.handleJoinStream(reconnected, { streamId: 'stream-1' });
      expect(await gateway.handleChatMessage(reconnected, { streamId: 'stream-1', message: 'c' })).toMatchObject({
        reason: 'RATE_LIMITED',
      });

      // Other users are not affected
      const other = createSocket('v4', 'user-2');
      await gateway.handleJoinStream(other, { streamId: 'stream-1' });
      expect(await gateway.handleChatMessage(other, { streamId: 'stream-1', message: 'd' })).toMatchObject({
        success: true,
      });
    });

    it('rate limits reactions per user, across tabs', async () => {
      const secondTab = createSocket('v2', 'user-1');
      await gateway.handleJoinStream(secondTab, { streamId: 'stream-1' });
      expect(gateway.handleReaction(viewer, { streamId: 'stream-1', emoji: '🔥' })).toEqual({ success: true });
      expect(gateway.handleReaction(secondTab, { streamId: 'stream-1', emoji: '🔥' })).toMatchObject({
        reason: 'RATE_LIMITED',
      });
    });

    it('rejects chat from sockets that did not join', async () => {
      const result = await gateway.handleChatMessage(createSocket('x1', 'user-2'), {
        streamId: 'stream-1',
        message: 'spam',
      });
      expect(result).toHaveProperty('error');
      expect(mockStreamingService.createChatMessage).not.toHaveBeenCalled();
    });

    it('broadcasts allowed reactions with clamped positions', () => {
      const result = gateway.handleReaction(viewer, { streamId: 'stream-1', emoji: '🔥', x: 150, y: -5 });
      expect(result).toEqual({ success: true });
      expect(eventsTo(streamRoom('stream-1'), 'reaction')).toEqual([{ emoji: '🔥', x: 100, y: 0, userId: 'user-1' }]);
    });

    it('rejects unknown reactions', () => {
      expect(gateway.handleReaction(viewer, { streamId: 'stream-1', emoji: '<script>' })).toEqual({
        error: 'Invalid reaction',
      });
    });
  });

  describe('notifyStreamEnded', () => {
    it('tells the room and drops the state', async () => {
      await gateway.handleJoinStream(createSocket('v1', 'user-1'), { streamId: 'stream-1' });
      gateway.notifyStreamEnded('stream-1');
      expect(eventsTo(streamRoom('stream-1'), 'stream-ended')).toEqual([{ streamId: 'stream-1' }]);
      expect(gateway.getViewerCount('stream-1')).toBe(0);
    });
  });

  describe('paid tips', () => {
    const tip = {
      transactionId: 'tx-1',
      streamId: 'stream-1',
      creatorId: 'creator-1',
      fromUser: { id: 'user-1', username: 'fan', displayName: null, avatar: null },
      amount: 10,
      message: 'Bravo !',
      completedAt: new Date('2026-10-19T12:00:00Z'),
    };

    it('announces the tip in the live chat', () => {
      gateway.notifyTip(tip);

      expect(eventsTo(streamRoom('stream-1'), 'chat-message')).toEqual([
        expect.objectContaining({ id: 'tip-tx-1', type: 'TIP', tipAmount: 10, message: 'Bravo !', username: 'fan' }),
      ]);
      expect(eventsTo(streamRoom('stream-1'), 'tip')).toEqual([
        expect.objectContaining({ transactionId: 'tx-1', amount: 10 }),
      ]);
    });

    it('ignores tips that were not sent from a live', () => {
      gateway.notifyTip({ ...tip, streamId: null });
      expect(emitted).toEqual([]);
    });

    it('listens to completed tips from the payment flow', () => {
      const { Subject } = jest.requireActual('rxjs');
      const tipCompleted$ = new Subject();
      const withPayments = new StreamingGateway(
        mockPrismaService as any,
        mockJwtService as any,
        mockStreamingService as any,
        { tipCompleted$ } as any,
      );
      withPayments.server = gateway.server;
      withPayments.onModuleInit();

      tipCompleted$.next(tip);
      withPayments.onModuleDestroy();
      tipCompleted$.next(tip);

      expect(eventsTo(streamRoom('stream-1'), 'chat-message')).toHaveLength(1);
    });
  });
});
