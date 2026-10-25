import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StreamingService } from './streaming.service';

/**
 * Lives: KYC gate, co-performers, text rules and moderator "end live"
 */
describe('StreamingService - moderation & publication gates', () => {
  let prisma: any;
  let service: StreamingService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'CREATOR', kycStatus: 'VERIFIED', status: 'ACTIVE' }) },
      liveStream: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 'live-1', ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 'live-1', streamKey: 'secret', ...data })),
      },
      coPerformer: { findMany: jest.fn().mockResolvedValue([]) },
      streamViewer: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
      notification: { create: jest.fn() },
    };
    const config = { get: jest.fn((_key: string, fallback?: any) => fallback) };
    service = new StreamingService(prisma, config as any, {} as any);
  });

  it('requires a verified identity to create or start a live', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'CREATOR', kycStatus: 'PENDING', status: 'ACTIVE' });
    await expect(service.createStream('creator-1', { title: 'Live' })).rejects.toThrow(ForbiddenException);

    prisma.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'SCHEDULED', source: 'BROWSER' });
    await expect(service.startStream('creator-1', 'live-1')).rejects.toThrow('Vérifiez votre identité pour publier');
    expect(prisma.liveStream.create).not.toHaveBeenCalled();
    expect(prisma.liveStream.update).not.toHaveBeenCalled();
  });

  it('stores verified co-performers and refuses prohibited titles', async () => {
    prisma.coPerformer.findMany.mockResolvedValue([{ id: 'cp-1', status: 'VERIFIED' }]);
    await service.createStream('creator-1', { title: 'Live à deux', coPerformerIds: ['cp-1'] });
    expect(prisma.liveStream.create.mock.calls[0][0].data.coPerformerIds).toEqual(['cp-1']);

    await expect(service.createStream('creator-1', { title: 'Rencontre réelle ce soir' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lets a moderator cut a live in progress, with audit and creator notification', async () => {
    prisma.liveStream.findUnique.mockResolvedValue({
      creatorId: 'creator-1',
      status: 'LIVE',
      startedAt: new Date(Date.now() - 60_000),
      source: 'BROWSER',
      title: 'Mon live',
    });

    const result: any = await service.moderatorEndStream('mod-1', 'live-1', 'Personne non déclarée à l’écran');

    expect(prisma.liveStream.update.mock.calls[0][0].data).toMatchObject({ status: 'ENDED' });
    expect(result.streamKey).toBeUndefined();
    expect(prisma.streamViewer.updateMany).toHaveBeenCalled();
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      userId: 'mod-1',
      action: 'LIVE_ENDED_BY_MODERATOR',
      resourceId: 'live-1',
    });
    expect(prisma.notification.create.mock.calls[0][0].data).toMatchObject({
      userId: 'creator-1',
      message: expect.stringContaining('Personne non déclarée'),
    });
  });

  it('cancels an announced live and refuses ended ones', async () => {
    prisma.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'SCHEDULED', title: 'Bientôt' });
    await service.moderatorEndStream('mod-1', 'live-1');
    expect(prisma.liveStream.update.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED' });

    prisma.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'ENDED', title: 'Fini' });
    await expect(service.moderatorEndStream('mod-1', 'live-1')).rejects.toThrow(BadRequestException);
  });
});
