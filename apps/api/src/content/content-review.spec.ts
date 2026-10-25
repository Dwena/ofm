import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContentService } from './content.service';

/**
 * Review before publication, co-performers and publication gates of content
 * (card network rules for adult content)
 */
describe('ContentService - review before publication', () => {
  const creatorId = 'creator-1';
  const verifiedCreator = { role: 'CREATOR', kycStatus: 'VERIFIED', status: 'ACTIVE' };

  let prisma: any;
  let storage: any;
  let config: Record<string, string>;
  let service: ContentService;

  const draft = {
    id: 'content-1',
    creatorId,
    title: 'Séance photo',
    description: null,
    caption: null,
    status: 'DRAFT',
    visibility: 'SUBSCRIBERS_ONLY',
    isPpv: false,
    ppvPrice: null,
    scheduledFor: null,
    publishedAt: null,
    deletedAt: null,
    soloContent: true,
    isModerated: false,
    files: [],
  };

  beforeEach(() => {
    config = {};
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(verifiedCreator) },
      content: {
        create: jest.fn().mockResolvedValue({ id: 'new-1', files: [] }),
        update: jest.fn(async ({ data }: any) => ({ ...draft, ...data })),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(),
      },
      contentFile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      contentCoPerformer: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      coPerformer: { findMany: jest.fn().mockResolvedValue([]) },
      creatorProfile: { updateMany: jest.fn() },
      notification: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
      contentUnlock: { findMany: jest.fn().mockResolvedValue([]) },
      contentLike: { findMany: jest.fn().mockResolvedValue([]) },
    };
    storage = { getSignedUrl: jest.fn(async (key: string) => `signed://${key}`) };
    const configService = { get: jest.fn((key: string, fallback?: any) => config[key] ?? fallback) };
    service = new ContentService(prisma, {} as any, storage, configService as any);
  });

  describe('co-performers on creation', () => {
    it('requires at least one co-performer when the content is not solo', async () => {
      await expect(
        service.createContent(creatorId, { type: 'PHOTO', soloContent: false } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.content.create).not.toHaveBeenCalled();
    });

    it('refuses co-performers that are not verified or not the creator\'s', async () => {
      prisma.coPerformer.findMany.mockResolvedValue([{ id: 'cp-1', status: 'PENDING' }]);
      await expect(
        service.createContent(creatorId, { type: 'PHOTO', soloContent: false, coPerformerIds: ['cp-1'] } as any),
      ).rejects.toThrow(/vérifiée/);

      prisma.coPerformer.findMany.mockResolvedValue([]);
      await expect(
        service.createContent(creatorId, { type: 'PHOTO', soloContent: false, coPerformerIds: ['cp-other'] } as any),
      ).rejects.toThrow('Co-participant introuvable');
      expect(prisma.coPerformer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ creatorId, deletedAt: null }) }),
      );
    });

    it('stores verified co-performers', async () => {
      prisma.coPerformer.findMany.mockResolvedValue([{ id: 'cp-1', status: 'VERIFIED' }]);
      await service.createContent(creatorId, {
        type: 'PHOTO',
        soloContent: false,
        coPerformerIds: ['cp-1', 'cp-1'],
      } as any);

      expect(prisma.content.create.mock.calls[0][0].data).toMatchObject({
        soloContent: false,
        coPerformers: { create: [{ coPerformerId: 'cp-1' }] },
      });
    });

    it('refuses co-performers on solo content', async () => {
      await expect(
        service.createContent(creatorId, { type: 'PHOTO', soloContent: true, coPerformerIds: ['cp-1'] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('text rules', () => {
    it('refuses prohibited terms even in drafts, allows adult vocabulary', async () => {
      await expect(
        service.createContent(creatorId, { type: 'PHOTO', title: 'Vidéo teen' } as any),
      ).rejects.toThrow(/termes interdits/);

      await service.createContent(creatorId, { type: 'PHOTO', title: 'Vidéo porno xxx' } as any);
      expect(prisma.content.create).toHaveBeenCalled();
    });

    it('sends content with terms to check to review with a note', async () => {
      await service.createContent(creatorId, { type: 'PHOTO', title: 'Encore endormie', publish: true } as any);
      expect(prisma.content.update.mock.calls[0][0].data).toMatchObject({
        status: 'UNDER_REVIEW',
        moderationNotes: expect.stringContaining('endormie'),
      });
    });
  });

  describe('publication gates', () => {
    it('blocks content with media flagged by the scan', async () => {
      prisma.contentFile.findMany.mockResolvedValue([{ scanStatus: 'FLAGGED' }]);
      await expect(
        service.createContent(creatorId, { type: 'PHOTO', publish: true, fileIds: [] } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses suspended creators', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...verifiedCreator, status: 'SUSPENDED' });
      await expect(
        service.createContent(creatorId, { type: 'PHOTO', publish: true } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('publishes directly when pre-moderation is off (local dev)', async () => {
      config.CONTENT_PREMODERATION = 'false';
      config.NODE_ENV = 'development';
      const result = await service.createContent(creatorId, { type: 'PHOTO', publish: true } as any);
      expect(result.status).toBe('PUBLISHED');
      expect(prisma.creatorProfile.updateMany).toHaveBeenCalled();
    });

    it('ignores CONTENT_PREMODERATION=false in production', async () => {
      config.CONTENT_PREMODERATION = 'false';
      config.NODE_ENV = 'production';
      const result = await service.createContent(creatorId, { type: 'PHOTO', publish: true } as any);
      expect(result.status).toBe('UNDER_REVIEW');
    });

    it('resubmits rejected content to review', async () => {
      prisma.content.findUnique.mockResolvedValue({ ...draft, status: 'REJECTED' });
      const result = await service.publishContent(creatorId, 'content-1');
      expect(result.status).toBe('UNDER_REVIEW');
    });

    it('publishes approved scheduled content early without a new review', async () => {
      prisma.content.findUnique.mockResolvedValue({
        ...draft,
        scheduledFor: new Date(Date.now() + 3600_000),
        isModerated: true,
      });
      const result = await service.publishContent(creatorId, 'content-1');
      expect(result.status).toBe('PUBLISHED');
    });

    it('only publishes scheduled content approved by a moderator', async () => {
      await service.publishScheduledContent();
      expect(prisma.content.findMany.mock.calls[0][0].where).toMatchObject({
        status: 'DRAFT',
        isModerated: true,
        files: { none: { scanStatus: 'FLAGGED' } },
        creator: { kycStatus: 'VERIFIED' },
      });
    });

    it('sends published content back to review when its co-performers change', async () => {
      prisma.content.findUnique.mockResolvedValue({ ...draft, status: 'PUBLISHED', publishedAt: new Date() });
      prisma.coPerformer.findMany.mockResolvedValue([{ id: 'cp-1', status: 'VERIFIED' }]);

      await service.updateContent(creatorId, 'content-1', { soloContent: false, coPerformerIds: ['cp-1'] });

      expect(prisma.contentCoPerformer.deleteMany).toHaveBeenCalledWith({ where: { contentId: 'content-1' } });
      expect(prisma.contentCoPerformer.createMany).toHaveBeenCalled();
      expect(prisma.content.update.mock.calls[0][0].data).toMatchObject({
        soloContent: false,
        status: 'UNDER_REVIEW',
      });
    });
  });

  describe('moderateContent', () => {
    const underReview = {
      ...draft,
      status: 'UNDER_REVIEW',
      files: [{ id: 'f-1', scanStatus: 'CLEAN' }],
      coPerformers: [],
      creator: { id: creatorId, kycStatus: 'VERIFIED', status: 'ACTIVE' },
    };

    it('publishes approved content and notifies the creator', async () => {
      prisma.content.findUnique.mockResolvedValue(underReview);

      await service.moderateContent('mod-1', 'content-1', true);

      expect(prisma.content.update.mock.calls[0][0].data).toMatchObject({
        status: 'PUBLISHED',
        isModerated: true,
        moderatedBy: 'mod-1',
        publishedAt: expect.any(Date),
        scheduledFor: null,
      });
      expect(prisma.notification.create.mock.calls[0][0].data).toMatchObject({
        userId: creatorId,
        type: 'CONTENT_APPROVED',
      });
      expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'CONTENT_APPROVED' });
    });

    it('keeps approved content scheduled when its date is in the future', async () => {
      const scheduledFor = new Date(Date.now() + 3600_000);
      prisma.content.findUnique.mockResolvedValue({ ...underReview, scheduledFor });

      await service.moderateContent('mod-1', 'content-1', true);

      expect(prisma.content.update.mock.calls[0][0].data).toMatchObject({
        status: 'DRAFT',
        scheduledFor,
        isModerated: true,
      });
    });

    it('rejects with a reason shown to the creator', async () => {
      prisma.content.findUnique.mockResolvedValue(underReview);

      await expect(service.moderateContent('mod-1', 'content-1', false)).rejects.toThrow(BadRequestException);

      await service.moderateContent('mod-1', 'content-1', false, 'Visage flouté requis');
      expect(prisma.content.update.mock.calls[0][0].data).toMatchObject({
        status: 'REJECTED',
        moderationNotes: 'Visage flouté requis',
      });
      expect(prisma.notification.create.mock.calls[0][0].data).toMatchObject({
        type: 'CONTENT_REJECTED',
        message: expect.stringContaining('Visage flouté requis'),
      });
    });

    it('cannot approve flagged media, unverified co-performers or an unverified creator', async () => {
      prisma.content.findUnique.mockResolvedValue({ ...underReview, files: [{ id: 'f', scanStatus: 'FLAGGED' }] });
      await expect(service.moderateContent('mod-1', 'content-1', true)).rejects.toThrow(BadRequestException);

      prisma.content.findUnique.mockResolvedValue({
        ...underReview,
        soloContent: false,
        coPerformers: [{ coPerformer: { id: 'cp', status: 'PENDING', deletedAt: null } }],
      });
      await expect(service.moderateContent('mod-1', 'content-1', true)).rejects.toThrow(BadRequestException);

      prisma.content.findUnique.mockResolvedValue({
        ...underReview,
        creator: { id: creatorId, kycStatus: 'REJECTED', status: 'ACTIVE' },
      });
      await expect(service.moderateContent('mod-1', 'content-1', true)).rejects.toThrow(BadRequestException);
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('waits for the media scan when a provider is configured', async () => {
      config.MEDIA_SCAN_PROVIDER = 'http';
      config.MEDIA_SCAN_API_URL = 'https://scan.example';
      prisma.content.findUnique.mockResolvedValue({ ...underReview, files: [{ id: 'f', scanStatus: 'PENDING' }] });
      await expect(service.moderateContent('mod-1', 'content-1', true)).rejects.toThrow(/analyse/);
    });

    it('only decides on content waiting for review', async () => {
      prisma.content.findUnique.mockResolvedValue({ ...underReview, status: 'PUBLISHED' });
      await expect(service.moderateContent('mod-1', 'content-1', true)).rejects.toThrow(BadRequestException);
    });
  });

  describe('review queue', () => {
    it('lists content under review with signed media, never flagged ones, and co-performers', async () => {
      prisma.content.findMany.mockResolvedValue([
        {
          ...draft,
          status: 'UNDER_REVIEW',
          ppvPrice: '4.99',
          files: [
            { id: 'f-1', storagePath: 'users/c/a.jpg', thumbnailPath: null, mimeType: 'image/jpeg', size: BigInt(10), scanStatus: 'CLEAN' },
            { id: 'f-2', storagePath: 'users/c/b.mp4', thumbnailPath: 'users/c/b.jpg', mimeType: 'video/mp4', size: BigInt(20), scanStatus: 'FLAGGED' },
          ],
          coPerformers: [{ coPerformer: { id: 'cp-1', status: 'VERIFIED', legalFirstName: 'Léa' } }],
        },
      ]);
      prisma.content.count.mockResolvedValue(1);

      const page = await service.getContentForModeration(1, 20);

      expect(prisma.content.findMany.mock.calls[0][0].where).toEqual({ status: 'UNDER_REVIEW', deletedAt: null });
      const [item] = page.items;
      expect(item.files[0]).toMatchObject({ type: 'IMAGE', url: 'signed://users/c/a.jpg', size: 10 });
      expect(item.files[1]).toMatchObject({ type: 'VIDEO', url: null, thumbnailUrl: null, scanStatus: 'FLAGGED' });
      expect(item.coPerformers).toEqual([{ id: 'cp-1', status: 'VERIFIED', legalFirstName: 'Léa' }]);
      expect(item.ppvPrice).toBe(4.99);
      expect(storage.getSignedUrl).toHaveBeenCalledWith('users/c/a.jpg', 900);
      expect(storage.getSignedUrl).not.toHaveBeenCalledWith('users/c/b.mp4', expect.anything());
    });
  });
});
