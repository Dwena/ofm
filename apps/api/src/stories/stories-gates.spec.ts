import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { StoriesService } from './stories.service';

/**
 * Stories are not pre-reviewed: they are gated by KYC, the known-illegal-media
 * scan, the text rules and verified co-performers
 */
describe('StoriesService - publication gates', () => {
  const userId = 'creator-1';
  const key = `users/${userId}/images/2026/10/a.jpg`;
  let prisma: any;
  let mediaScan: any;
  let service: StoriesService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'CREATOR', kycStatus: 'VERIFIED', status: 'ACTIVE' }) },
      story: {
        create: jest.fn(async ({ data }: any) => ({ id: 'story-1', ...data, creator: { id: userId }, _count: { views: 0, likes: 0 } })),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      coPerformer: { findMany: jest.fn().mockResolvedValue([]) },
      storyView: { findMany: jest.fn().mockResolvedValue([]) },
      storyLike: { findMany: jest.fn().mockResolvedValue([]) },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
    };
    mediaScan = { scanStoredFile: jest.fn().mockResolvedValue('CLEAN'), isEnabled: true };
    const storage = { getSignedUrl: jest.fn(async (k: string) => `signed://${k}`) };
    service = new StoriesService(prisma, storage as any, {} as any, {} as any, mediaScan);
  });

  it('requires a verified identity', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'CREATOR', kycStatus: 'NOT_STARTED', status: 'ACTIVE' });
    await expect(service.createStory(userId, { type: 'TEXT' as any, text: 'Coucou' })).rejects.toThrow(
      'Vérifiez votre identité pour publier',
    );
    expect(prisma.story.create).not.toHaveBeenCalled();
  });

  it('scans the media before the story is visible and records the result', async () => {
    await service.createStory(userId, { type: 'PHOTO' as any, mediaUrl: key });

    expect(mediaScan.scanStoredFile).toHaveBeenCalledWith(expect.objectContaining({ userId, key }));
    expect(prisma.story.create.mock.calls[0][0].data.scanStatus).toBe('CLEAN');
  });

  it('refuses a story whose media matches known illegal content', async () => {
    mediaScan.scanStoredFile.mockResolvedValue('FLAGGED');
    await expect(service.createStory(userId, { type: 'PHOTO' as any, mediaUrl: key })).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.story.create).not.toHaveBeenCalled();
  });

  it('does not publish while the configured scanner is unavailable', async () => {
    mediaScan.scanStoredFile.mockResolvedValue('PENDING');
    await expect(service.createStory(userId, { type: 'PHOTO' as any, mediaUrl: key })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('only accepts verified co-performers of the creator', async () => {
    prisma.coPerformer.findMany.mockResolvedValue([{ id: 'cp-1', status: 'PENDING' }]);
    await expect(
      service.createStory(userId, { type: 'TEXT' as any, text: 'Duo', coPerformerIds: ['cp-1'] }),
    ).rejects.toThrow(BadRequestException);

    prisma.coPerformer.findMany.mockResolvedValue([{ id: 'cp-1', status: 'VERIFIED' }]);
    await service.createStory(userId, { type: 'TEXT' as any, text: 'Duo', coPerformerIds: ['cp-1'] });
    expect(prisma.story.create.mock.calls[0][0].data.coPerformerIds).toEqual(['cp-1']);
  });

  it('refuses prohibited terms', async () => {
    await expect(
      service.createStory(userId, { type: 'TEXT' as any, text: 'Plan cul ce soir, tarif nuit en MP' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps flagged stories (evidence) when cleaning expired ones', async () => {
    await service.cleanupExpiredStories();
    expect(prisma.story.deleteMany.mock.calls[0][0].where).toMatchObject({ scanStatus: { not: 'FLAGGED' } });
  });
});
