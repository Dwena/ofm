import { ForbiddenException } from '@nestjs/common';
import { StreamingGateway, AuthenticatedStreamSocket } from './streaming.gateway';
import { StreamingController } from './streaming.controller';

/**
 * Watching a live needs a verified age (law n° 2024-449 "SREN"): socket join
 * (P2P video) and LiveKit viewer token
 */
describe('Live streaming age verification', () => {
  const liveStream = { id: 'stream-1', creatorId: 'creator-1', visibility: 'PUBLIC', isPpv: false, status: 'LIVE' };

  const streamingService = {
    getStreamForRealtime: jest.fn(),
    checkViewAccess: jest.fn(),
    registerViewer: jest.fn(),
    getRecentChatMessages: jest.fn(),
    updateViewerStats: jest.fn(),
    getLiveKitToken: jest.fn(),
  };
  const ageVerification = { isAgeVerifiedFor: jest.fn() };

  const socket = (userId: string, ageVerificationToken?: string) =>
    ({
      id: `socket-${userId}`,
      userId,
      user: { id: userId, username: userId },
      ageVerificationToken,
      handshake: { auth: {}, headers: {} },
      join: jest.fn(),
      leave: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
    }) as unknown as AuthenticatedStreamSocket;

  let gateway: StreamingGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    streamingService.getStreamForRealtime.mockResolvedValue(liveStream);
    streamingService.checkViewAccess.mockImplementation(async (userId: string) => ({
      allowed: true,
      isCreator: userId === liveStream.creatorId,
    }));
    streamingService.getRecentChatMessages.mockResolvedValue([]);
    streamingService.registerViewer.mockResolvedValue({ firstView: true });
    streamingService.updateViewerStats.mockResolvedValue(undefined);

    gateway = new StreamingGateway(
      {} as any,
      {} as any,
      streamingService as any,
      undefined,
      undefined,
      undefined,
      undefined,
      ageVerification as any,
    );
    gateway.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
  });

  afterEach(() => gateway.onModuleDestroy());

  it('refuses a viewer whose age is not verified', async () => {
    ageVerification.isAgeVerifiedFor.mockResolvedValue(false);

    const result = await gateway.handleJoinStream(socket('fan-1', 'tok'), { streamId: 'stream-1' });

    expect(result).toEqual({ error: 'Forbidden', reason: 'AGE_VERIFICATION_REQUIRED' });
    expect(ageVerification.isAgeVerifiedFor).toHaveBeenCalledWith({ userId: 'fan-1', token: 'tok' });
    expect(streamingService.registerViewer).not.toHaveBeenCalled();
  });

  it('lets a verified viewer join', async () => {
    ageVerification.isAgeVerifiedFor.mockResolvedValue(true);
    const result = await gateway.handleJoinStream(socket('fan-1'), { streamId: 'stream-1' });
    expect(result).toMatchObject({ success: true });
  });

  it('never asks the creator of the live', async () => {
    const result = await gateway.handleJoinStream(socket('creator-1'), { streamId: 'stream-1' });
    expect(result).toMatchObject({ success: true });
    expect(ageVerification.isAgeVerifiedFor).not.toHaveBeenCalled();
  });

  describe('LiveKit token', () => {
    const controller = new StreamingController(streamingService as any, {} as any, {} as any, {} as any);

    it('refuses the viewer token with 403 AGE_VERIFICATION_REQUIRED', async () => {
      await expect(controller.getLiveKitToken('fan-1', 'stream-1', {} as any, false)).rejects.toThrow(
        new ForbiddenException('AGE_VERIFICATION_REQUIRED'),
      );
      expect(streamingService.getLiveKitToken).not.toHaveBeenCalled();
    });

    it('gives the creator their publisher token and verified viewers theirs', async () => {
      streamingService.getLiveKitToken.mockResolvedValue({ token: 't' });
      await expect(controller.getLiveKitToken('creator-1', 'stream-1', {} as any, false)).resolves.toEqual({ token: 't' });
      await expect(controller.getLiveKitToken('fan-1', 'stream-1', {} as any, true)).resolves.toEqual({ token: 't' });
    });
  });
});
