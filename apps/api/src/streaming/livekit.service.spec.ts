import { createHash } from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import {
  LIVEKIT_TOKEN_TTL_SECONDS,
  LiveKitService,
  liveKitRoomName,
  readLiveKitConfig,
  streamIdFromRoom,
  userIdFromIdentity,
} from './livekit.service';

const roomService = {
  deleteRoom: jest.fn(),
  listParticipants: jest.fn(),
  removeParticipant: jest.fn(),
};

jest.mock('livekit-server-sdk', () => {
  const actual = jest.requireActual('livekit-server-sdk');
  return {
    ...actual,
    RoomServiceClient: jest.fn().mockImplementation((...args: unknown[]) => {
      roomServiceArgs.push(args);
      return roomService;
    }),
  };
});
const roomServiceArgs: unknown[][] = [];

const API_KEY = 'devkey';
const API_SECRET = 'a-long-development-secret-of-at-least-32-chars';

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

describe('LiveKitService', () => {
  const env = process.env;

  const createService = (vars: Record<string, string | undefined>) => {
    process.env = { ...env, LIVEKIT_URL: undefined, LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined, ...vars };
    return new LiveKitService();
  };

  const configured = () =>
    createService({ LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: API_KEY, LIVEKIT_API_SECRET: API_SECRET });

  beforeEach(() => {
    jest.clearAllMocks();
    roomServiceArgs.length = 0;
  });

  afterAll(() => {
    process.env = env;
  });

  describe('configuration', () => {
    it('is disabled (P2P mode) unless the URL, key and secret are all set', () => {
      expect(createService({}).enabled).toBe(false);
      expect(createService({}).transport).toBe('p2p');
      expect(createService({ LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: API_KEY }).transport).toBe('p2p');
      expect(createService({ LIVEKIT_API_KEY: API_KEY, LIVEKIT_API_SECRET: API_SECRET }).enabled).toBe(false);
      expect(configured().transport).toBe('livekit');
    });

    it('derives the room service URL from the public URL', () => {
      expect(readLiveKitConfig({ LIVEKIT_URL: 'wss://live.example.com', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }))
        .toEqual({ url: 'wss://live.example.com', apiUrl: 'https://live.example.com', apiKey: 'k', apiSecret: 's' });
      expect(
        readLiveKitConfig({
          LIVEKIT_URL: 'ws://localhost:7880',
          LIVEKIT_API_URL: 'http://livekit:7880',
          LIVEKIT_API_KEY: 'k',
          LIVEKIT_API_SECRET: 's',
        })?.apiUrl,
      ).toBe('http://livekit:7880');
      expect(readLiveKitConfig({ LIVEKIT_URL: '  ', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' })).toBeNull();
    });

    it('refuses to create tokens when disabled', async () => {
      await expect(
        createService({}).createToken({ streamId: 's1', userId: 'u1', role: 'viewer' }),
      ).rejects.toThrow('LiveKit is not configured');
    });

    it('maps rooms and identities', () => {
      expect(liveKitRoomName('abc')).toBe('live-abc');
      expect(streamIdFromRoom('live-abc')).toBe('abc');
      expect(streamIdFromRoom('other')).toBeUndefined();
      expect(userIdFromIdentity('user-1:ab12cd34')).toBe('user-1');
      expect(userIdFromIdentity('user-1')).toBe('user-1');
    });
  });

  describe('createToken', () => {
    it('gives the creator a camera + microphone publisher token', async () => {
      const result = await configured().createToken({
        streamId: 'stream-1',
        userId: 'creator-1',
        name: 'Alice',
        role: 'publisher',
      });

      expect(result).toMatchObject({
        url: 'ws://localhost:7880',
        room: 'live-stream-1',
        identity: 'creator-1',
        transport: 'livekit',
        expiresIn: LIVEKIT_TOKEN_TTL_SECONDS,
      });
      const claims = decode(result.token);
      expect(claims.iss).toBe(API_KEY);
      expect(claims.sub).toBe('creator-1');
      expect(claims.name).toBe('Alice');
      expect(claims.exp - claims.nbf).toBe(LIVEKIT_TOKEN_TTL_SECONDS);
      expect(claims.video).toEqual({
        room: 'live-stream-1',
        roomJoin: true,
        canPublish: true,
        canPublishSources: ['camera', 'microphone'],
        canSubscribe: false,
        canPublishData: false,
      });
    });

    it('gives viewers a hidden, subscribe-only token with a per-connection identity', async () => {
      const service = configured();
      const first = await service.createToken({ streamId: 'stream-1', userId: 'user-1', name: 'David', role: 'viewer' });
      const second = await service.createToken({ streamId: 'stream-1', userId: 'user-1', role: 'viewer' });

      expect(first.identity).toMatch(/^user-1:[0-9a-f]{8}$/);
      expect(second.identity).not.toBe(first.identity);
      const claims = decode(first.token);
      expect(claims.sub).toBe(first.identity);
      expect(claims.attributes).toEqual({ userId: 'user-1', role: 'viewer' });
      expect(claims.video).toEqual({
        room: 'live-stream-1',
        roomJoin: true,
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
        hidden: true,
      });
    });
  });

  describe('rooms', () => {
    it('deletes the live room through the room service', async () => {
      roomService.deleteRoom.mockResolvedValue(undefined);
      await expect(configured().deleteRoom('stream-1')).resolves.toBe(true);
      expect(roomServiceArgs[0]).toEqual(['http://localhost:7880', API_KEY, API_SECRET, { requestTimeout: 5 }]);
      expect(roomService.deleteRoom).toHaveBeenCalledWith('live-stream-1');
    });

    it('never throws when the room cannot be deleted', async () => {
      roomService.deleteRoom.mockRejectedValue(new Error('requested room does not exist'));
      await expect(configured().deleteRoom('stream-1')).resolves.toBe(false);
      roomService.deleteRoom.mockRejectedValue(new Error('connect ECONNREFUSED'));
      await expect(configured().deleteRoom('stream-1')).resolves.toBe(false);
    });

    it('does nothing in P2P mode', async () => {
      await expect(createService({}).deleteRoom('stream-1')).resolves.toBe(false);
      expect(roomService.deleteRoom).not.toHaveBeenCalled();
    });

    it('removes every connection of a user', async () => {
      roomService.listParticipants.mockResolvedValue([
        { identity: 'user-1:aaaa1111' },
        { identity: 'user-1:bbbb2222' },
        { identity: 'user-2:cccc3333' },
        { identity: 'creator-1' },
      ]);
      roomService.removeParticipant.mockResolvedValue(undefined);

      await expect(configured().removeUser('stream-1', 'user-1')).resolves.toBe(2);
      expect(roomService.removeParticipant).toHaveBeenCalledTimes(2);
      expect(roomService.removeParticipant).toHaveBeenCalledWith('live-stream-1', 'user-1:aaaa1111');
      expect(roomService.removeParticipant).toHaveBeenCalledWith('live-stream-1', 'user-1:bbbb2222');
    });
  });

  describe('webhooks', () => {
    const signedWebhook = async (body: string, secret = API_SECRET) => {
      const token = new AccessToken(API_KEY, secret);
      token.sha256 = createHash('sha256').update(body).digest('base64');
      return token.toJwt();
    };

    const event = (name: string, identity?: string, room = 'live-stream-1') =>
      JSON.stringify({
        event: name,
        room: { name: room },
        ...(identity && { participant: { identity } }),
        id: `${name}-${identity}`,
        createdAt: '1792500000',
      });

    it('accepts a correctly signed webhook', async () => {
      const service = configured();
      const body = event('participant_joined', 'user-1:aaaa1111');
      const decoded = await service.receiveWebhook(body, await signedWebhook(body));
      expect(decoded.event).toBe('participant_joined');
      expect(decoded.participant?.identity).toBe('user-1:aaaa1111');
    });

    it('rejects a webhook signed with another secret or a modified body', async () => {
      const service = configured();
      const body = event('participant_joined', 'user-1:aaaa1111');
      await expect(service.receiveWebhook(body, await signedWebhook(body, 'another-secret-another-secret-123'))).rejects.toThrow();
      await expect(
        service.receiveWebhook(event('participant_joined', 'user-2:bbbb2222'), await signedWebhook(body)),
      ).rejects.toThrow();
    });

    it('counts the viewers connected to the video, not the publisher', async () => {
      const service = configured();
      const counts: number[] = [];
      service.videoViewers$.subscribe(({ count }) => counts.push(count));
      const receive = async (body: string) =>
        service.handleWebhookEvent(await service.receiveWebhook(body, await signedWebhook(body)));

      await receive(event('participant_joined', 'creator-1'));
      await receive(event('participant_joined', 'user-1:aaaa1111'));
      await receive(event('participant_joined', 'user-2:bbbb2222'));
      await receive(event('participant_left', 'user-1:aaaa1111'));
      await receive(event('participant_joined', 'user-3:cccc3333', 'other-room'));

      expect(counts).toEqual([1, 2, 1]);
      expect(service.getVideoViewerCount('stream-1')).toBe(1);

      await receive(event('room_finished'));
      expect(counts).toEqual([1, 2, 1, 0]);
      expect(service.getVideoViewerCount('stream-1')).toBeNull();

      // LiveKit restarted: the old connections never sent participant_left
      await receive(event('participant_joined', 'user-1:aaaa1111'));
      await receive(event('room_started'));
      await receive(event('participant_joined', 'user-1:dddd4444'));
      expect(service.getVideoViewerCount('stream-1')).toBe(1);
    });
  });
});
