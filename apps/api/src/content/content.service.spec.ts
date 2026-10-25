import { Test, TestingModule } from '@nestjs/testing';
import { ContentService } from './content.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/database/prisma.service';
import { PaymentFlowService } from '../payments/payment-flow.service';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

describe('ContentService', () => {
  let service: ContentService;
  let prisma: PrismaService;

  const mockPrismaService = {
    content: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    contentFile: {
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    contentCoPerformer: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    coPerformer: {
      findMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    contentLike: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    contentUnlock: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      groupBy: jest.fn(),
    },
    creatorProfile: {
      updateMany: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockOneTimePayments = {
    startPayment: jest.fn(),
    confirmPayment: jest.fn(),
  };

  const mockStorageService = {
    getSignedUrl: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => defaultValue),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        { provide: PaymentFlowService, useValue: mockOneTimePayments },
        { provide: StorageService, useValue: mockStorageService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: SettingsService,
          useValue: { getPlatformFeePercentage: jest.fn(async () => 15) },
        },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
    prisma = module.get<PrismaService>(PrismaService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('toggleLike', () => {
    const userId = 'user-123';
    const contentId = 'content-456';

    it('should like content when not already liked', async () => {
      const mockContent = {
        id: contentId,
        deletedAt: null,
        status: 'PUBLISHED',
      };

      mockPrismaService.content.findUnique.mockResolvedValue(mockContent);
      mockPrismaService.contentLike.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockResolvedValue([
        { id: 'like-123' },
        { likeCount: 1 },
      ]);

      const result = await service.toggleLike(userId, contentId);

      expect(result).toEqual({ liked: true, message: 'Content liked' });
      expect(mockPrismaService.content.findUnique).toHaveBeenCalledWith({
        where: { id: contentId },
        select: { id: true, deletedAt: true, status: true },
      });
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should unlike content when already liked', async () => {
      const mockContent = {
        id: contentId,
        deletedAt: null,
        status: 'PUBLISHED',
      };
      const mockLike = { id: 'like-123' };

      mockPrismaService.content.findUnique.mockResolvedValue(mockContent);
      mockPrismaService.contentLike.findUnique.mockResolvedValue(mockLike);
      mockPrismaService.$transaction.mockResolvedValue([null, { likeCount: 0 }]);

      const result = await service.toggleLike(userId, contentId);

      expect(result).toEqual({ liked: false, message: 'Content unliked' });
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException if content not found', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(null);

      await expect(service.toggleLike(userId, contentId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if content is deleted', async () => {
      const mockContent = {
        id: contentId,
        deletedAt: new Date(),
        status: 'PUBLISHED',
      };

      mockPrismaService.content.findUnique.mockResolvedValue(mockContent);

      await expect(service.toggleLike(userId, contentId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw error if content is not published', async () => {
      const mockContent = {
        id: contentId,
        deletedAt: null,
        status: 'DRAFT',
      };

      mockPrismaService.content.findUnique.mockResolvedValue(mockContent);

      await expect(service.toggleLike(userId, contentId)).rejects.toThrow(
        'Cannot like unpublished content',
      );
    });
  });

  describe('getLikes', () => {
    const contentId = 'content-456';

    it('should return paginated likes for content', async () => {
      const mockContent = { id: contentId, deletedAt: null };
      const mockLikes = [
        {
          id: 'like-1',
          user: { id: 'user-1', username: 'user1', displayName: 'User 1', avatar: null },
          createdAt: new Date(),
        },
      ];

      mockPrismaService.content.findUnique.mockResolvedValue(mockContent);
      mockPrismaService.contentLike.findMany.mockResolvedValue(mockLikes);
      mockPrismaService.contentLike.count.mockResolvedValue(1);

      const result = await service.getLikes(contentId, 1, 20);

      expect(result).toEqual({
        items: mockLikes,
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(mockPrismaService.contentLike.findMany).toHaveBeenCalled();
    });

    it('should throw NotFoundException if content not found', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(null);

      await expect(service.getLikes(contentId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('hasUserLiked', () => {
    const userId = 'user-123';
    const contentId = 'content-456';

    it('should return true if user has liked content', async () => {
      mockPrismaService.contentLike.findUnique.mockResolvedValue({ id: 'like-123' });

      const result = await service.hasUserLiked(userId, contentId);

      expect(result).toBe(true);
    });

    it('should return false if user has not liked content', async () => {
      mockPrismaService.contentLike.findUnique.mockResolvedValue(null);

      const result = await service.hasUserLiked(userId, contentId);

      expect(result).toBe(false);
    });
  });

  describe('content access', () => {
    const viewerId = 'viewer-1';
    const file = {
      id: 'file-1',
      contentId: 'content-1',
      storagePath: 'users/creator-1/images/a.jpg',
      thumbnailPath: null,
      mimeType: 'image/jpeg',
      size: BigInt(1024),
    };
    const baseContent = {
      id: 'content-1',
      creatorId: 'creator-1',
      status: 'PUBLISHED',
      visibility: 'SUBSCRIBERS_ONLY',
      isPpv: true,
      ppvPrice: 9.99,
      files: [file],
      _count: { likes: 0, comments: 0 },
    };

    beforeEach(() => {
      mockPrismaService.subscription.findMany.mockResolvedValue([]);
      mockPrismaService.contentUnlock.findMany.mockResolvedValue([]);
      mockPrismaService.contentLike.findMany.mockResolvedValue([]);
      mockStorageService.getSignedUrl.mockResolvedValue('https://signed.example/a.jpg');
    });

    it('should hide PPV media when the viewer has not unlocked it', async () => {
      mockPrismaService.content.findMany.mockResolvedValue([baseContent]);
      // Even an active subscription does not grant PPV access
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { tier: { creatorId: 'creator-1' } },
      ]);

      const [item] = await service.getFeed(viewerId);

      expect(item.isLocked).toBe(true);
      expect(item.files).toEqual([]);
      expect(item.mediaCount).toBe(1);
      expect(item.ppvPrice).toBe(9.99);
      expect(mockStorageService.getSignedUrl).not.toHaveBeenCalled();
    });

    it('should expose signed media URLs once PPV content is unlocked', async () => {
      mockPrismaService.content.findMany.mockResolvedValue([baseContent]);
      mockPrismaService.contentUnlock.findMany.mockResolvedValue([{ contentId: 'content-1' }]);
      mockPrismaService.contentLike.findMany.mockResolvedValue([{ contentId: 'content-1' }]);

      const [item] = await service.getFeed(viewerId);

      expect(item.isLocked).toBe(false);
      expect(item.hasUnlocked).toBe(true);
      expect(item.isLiked).toBe(true);
      expect(item.files).toHaveLength(1);
      expect(item.files[0]).toMatchObject({
        id: 'file-1',
        type: 'IMAGE',
        size: 1024,
        url: 'https://signed.example/a.jpg',
      });
      expect(item.files[0]).not.toHaveProperty('storagePath');
    });

    it('should lock subscribers-only content for non-subscribers', async () => {
      mockPrismaService.content.findMany.mockResolvedValue([
        { ...baseContent, isPpv: false, ppvPrice: null },
      ]);

      const [item] = await service.getFeed(viewerId);

      expect(item.isLocked).toBe(true);
      expect(item.files).toEqual([]);
    });

    it('should always give the creator access to their own content', async () => {
      mockPrismaService.content.findMany.mockResolvedValue([baseContent]);

      const [item] = await service.getCreatorContent('creator-1', 'creator-1');

      expect(item.isLocked).toBe(false);
      expect(item.files).toHaveLength(1);
    });
  });

  describe('getSubscriptionsFeed', () => {
    it('should return an empty list without querying content when user has no subscriptions', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([]);

      const result = await service.getSubscriptionsFeed('user-1');

      expect(result).toEqual([]);
      expect(mockPrismaService.content.findMany).not.toHaveBeenCalled();
    });

    it('should only query content from subscribed creators', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { tier: { creatorId: 'creator-1' } },
      ]);
      mockPrismaService.content.findMany.mockResolvedValue([]);

      await service.getSubscriptionsFeed('user-1', 2, 10);

      expect(mockPrismaService.content.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ creatorId: { in: ['creator-1'] } }),
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('unlockContent', () => {
    const userId = 'user-123';
    const contentId = 'content-456';
    const ppvContent = {
      id: contentId,
      creatorId: 'creator-1',
      status: 'PUBLISHED',
      deletedAt: null,
      isPpv: true,
      ppvPrice: 10,
      creator: {
        id: 'creator-1',
        username: 'creator',
      },
    };

    const pendingPayment = {
      status: 'requires_redirect',
      completed: false,
      transactionId: 'tx-1',
      redirectUrl: 'https://pay.example/checkout',
      amount: 10,
      vatRate: 20,
      vatAmount: 2,
      totalAmount: 12,
      failureReason: null,
    };

    it('should start a pending payment without granting access', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(ppvContent);
      mockPrismaService.contentUnlock.findUnique.mockResolvedValue(null);
      mockOneTimePayments.startPayment.mockResolvedValue(pendingPayment);

      const result = await service.unlockContent(userId, contentId);

      expect(mockOneTimePayments.startPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          payerId: userId,
          creatorId: 'creator-1',
          kind: 'content_unlock',
          amount: 10,
          contentId,
          returnPath: `/content/${contentId}`,
        }),
      );
      // Nothing is granted before the provider confirms the payment
      expect(mockPrismaService.contentUnlock.create).not.toHaveBeenCalled();
      expect(mockPrismaService.transaction.create).not.toHaveBeenCalled();
      expect(mockPrismaService.creatorProfile.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        ...pendingPayment,
        unlocked: false,
        alreadyUnlocked: false,
        contentId,
      });
    });

    it('should pass the saved card and report an immediate success', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(ppvContent);
      mockPrismaService.contentUnlock.findUnique.mockResolvedValue(null);
      mockOneTimePayments.startPayment.mockResolvedValue({
        ...pendingPayment,
        status: 'completed',
        completed: true,
        redirectUrl: null,
      });

      const result = await service.unlockContent(userId, contentId, { paymentCardId: 'card-1', withdrawalWaiver: true });

      expect(mockOneTimePayments.startPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentCardId: 'card-1', withdrawalWaiver: true }),
      );
      expect(result.unlocked).toBe(true);
    });

    it('should not charge again if already unlocked', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(ppvContent);
      mockPrismaService.contentUnlock.findUnique.mockResolvedValue({ id: 'unlock-1' });

      const result = await service.unlockContent(userId, contentId);

      expect(result).toEqual({ unlocked: true, alreadyUnlocked: true, contentId });
      expect(mockOneTimePayments.startPayment).not.toHaveBeenCalled();
    });

    it('should reject non-PPV content', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue({ ...ppvContent, isPpv: false });

      await expect(service.unlockContent(userId, contentId)).rejects.toThrow(BadRequestException);
    });

    it('should reject unlocking own content', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(ppvContent);

      await expect(service.unlockContent('creator-1', contentId)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for missing content', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(null);

      await expect(service.unlockContent(userId, contentId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmUnlock', () => {
    it('should confirm the payment for this content', async () => {
      mockOneTimePayments.confirmPayment.mockResolvedValue({
        status: 'completed',
        completed: true,
        transactionId: 'tx-1',
        redirectUrl: null,
        amount: 10,
      });

      const result = await service.confirmUnlock('user-123', 'content-456', 'tx-1');

      expect(mockOneTimePayments.confirmPayment).toHaveBeenCalledWith('user-123', 'tx-1', {
        kind: 'content_unlock',
        contentId: 'content-456',
      });
      expect(result).toEqual(expect.objectContaining({ unlocked: true, contentId: 'content-456' }));
    });
  });
  describe('content management', () => {
    const creatorId = 'creator-1';
    const ownContent = {
      id: 'content-1',
      creatorId,
      status: 'DRAFT',
      visibility: 'SUBSCRIBERS_ONLY',
      isPpv: false,
      ppvPrice: null,
      scheduledFor: null,
      publishedAt: null,
      deletedAt: null,
      files: [],
      _count: { likes: 0, comments: 0 },
    };

    beforeEach(() => {
      mockPrismaService.subscription.findMany.mockResolvedValue([]);
      mockPrismaService.contentUnlock.findMany.mockResolvedValue([]);
      mockPrismaService.contentLike.findMany.mockResolvedValue([]);
      mockPrismaService.content.count.mockResolvedValue(0);
      mockPrismaService.creatorProfile.updateMany.mockResolvedValue({ count: 1 });
    });

    describe('createContent', () => {
      beforeEach(() => {
        mockPrismaService.user.findUnique.mockResolvedValue({ role: 'CREATOR', kycStatus: 'VERIFIED', status: 'ACTIVE' });
        mockPrismaService.content.create.mockResolvedValue({ id: 'new-1', files: [] });
        mockPrismaService.content.update.mockImplementation(async ({ data }: any) => ({ ...ownContent, id: 'new-1', ...data }));
        mockPrismaService.contentFile.updateMany.mockResolvedValue({ count: 1 });
        mockPrismaService.contentFile.findMany.mockResolvedValue([]);
      });

      it('should only link files uploaded by the creator and not yet attached', async () => {
        await service.createContent(creatorId, { type: 'PHOTO', fileIds: ['f-1', 'f-2'] } as any);

        expect(mockPrismaService.contentFile.updateMany).toHaveBeenCalledTimes(2);
        expect(mockPrismaService.contentFile.updateMany).toHaveBeenCalledWith({
          where: { id: 'f-2', contentId: null, storagePath: { startsWith: 'users/creator-1/' } },
          data: { contentId: 'new-1', order: 1 },
        });
      });

      it('should send content to review when asked to publish (pre-moderation)', async () => {
        const result = await service.createContent(creatorId, { type: 'PHOTO', publish: true } as any);

        expect(mockPrismaService.content.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'DRAFT', publishedAt: null }),
          }),
        );
        expect(mockPrismaService.content.update.mock.calls[0][0].data).toMatchObject({
          status: 'UNDER_REVIEW',
          submittedForReviewAt: expect.any(Date),
          isModerated: false,
        });
        expect(result.status).toBe('UNDER_REVIEW');
        expect(mockPrismaService.creatorProfile.updateMany).not.toHaveBeenCalled();
      });

      it('should keep the schedule of content sent to review', async () => {
        const scheduledFor = new Date(Date.now() + 3600_000);
        await service.createContent(creatorId, { type: 'PHOTO', publish: true, scheduledFor } as any);

        expect(mockPrismaService.content.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'DRAFT', publishedAt: null, scheduledFor }),
          }),
        );
        expect(mockPrismaService.content.update.mock.calls[0][0].data).toMatchObject({
          status: 'UNDER_REVIEW',
          scheduledFor,
        });
      });

      it('should refuse publication without a verified identity, but allow drafts', async () => {
        mockPrismaService.user.findUnique.mockResolvedValue({ role: 'CREATOR', kycStatus: 'PENDING', status: 'ACTIVE' });

        await expect(
          service.createContent(creatorId, { type: 'PHOTO', publish: true } as any),
        ).rejects.toThrow('Vérifiez votre identité pour publier');
        expect(mockPrismaService.content.create).not.toHaveBeenCalled();

        await service.createContent(creatorId, { type: 'PHOTO' } as any);
        expect(mockPrismaService.content.create).toHaveBeenCalled();
      });

      it('should reject a schedule date in the past', async () => {
        await expect(
          service.createContent(creatorId, {
            type: 'PHOTO',
            scheduledFor: new Date(Date.now() - 60_000),
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('should require a price for PPV visibility', async () => {
        await expect(
          service.createContent(creatorId, { type: 'PHOTO', visibility: 'PPV' } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('should flag PPV visibility as pay-per-view', async () => {
        await service.createContent(creatorId, { type: 'PHOTO', visibility: 'PPV', ppvPrice: 5 } as any);

        expect(mockPrismaService.content.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ isPpv: true, ppvPrice: 5, visibility: 'PPV' }),
          }),
        );
      });
    });

    describe('getMyContent', () => {
      it('should return every status with stats and per-status counts', async () => {
        mockPrismaService.content.findMany
          .mockResolvedValueOnce([
            { ...ownContent, status: 'PUBLISHED', viewCount: 42, _count: { likes: 3, comments: 2, unlocks: 4 } },
          ])
          .mockResolvedValueOnce([
            { status: 'PUBLISHED', scheduledFor: null },
            { status: 'DRAFT', scheduledFor: null },
            { status: 'DRAFT', scheduledFor: new Date() },
            { status: 'ARCHIVED', scheduledFor: null },
            { status: 'REJECTED', scheduledFor: null },
          ]);
        mockPrismaService.content.count.mockResolvedValue(1);
        mockPrismaService.transaction.groupBy.mockResolvedValue([
          { contentId: 'content-1', _sum: { netAmount: 33.96 } },
        ]);

        const result = await service.getMyContent(creatorId, {});

        expect(result.counts).toEqual({ ALL: 5, PUBLISHED: 1, DRAFT: 1, SCHEDULED: 1, ARCHIVED: 1, REVIEW: 1 });
        expect(result.total).toBe(1);
        expect(result.items[0].stats).toEqual({ views: 42, likes: 3, comments: 2, unlocks: 4, revenue: 33.96 });
        expect(mockPrismaService.content.findMany.mock.calls[0][0].where).toEqual({
          creatorId,
          deletedAt: null,
        });
      });

      it('should filter scheduled drafts', async () => {
        mockPrismaService.content.findMany.mockResolvedValue([]);

        await service.getMyContent(creatorId, { status: 'SCHEDULED' as any });

        expect(mockPrismaService.content.findMany.mock.calls[0][0].where).toEqual({
          creatorId,
          deletedAt: null,
          status: 'DRAFT',
          scheduledFor: { not: null },
        });
        expect(mockPrismaService.transaction.groupBy).not.toHaveBeenCalled();
      });
    });

    describe('updateContent', () => {
      beforeEach(() => {
        mockPrismaService.content.update.mockImplementation(async ({ data }: any) => ({ ...ownContent, ...data }));
      });

      it('should forbid updating content of another creator', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, creatorId: 'other' });

        await expect(service.updateContent(creatorId, 'content-1', { title: 'x' })).rejects.toThrow(
          ForbiddenException,
        );
        expect(mockPrismaService.content.update).not.toHaveBeenCalled();
      });

      it('should not update deleted content', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, deletedAt: new Date() });

        await expect(service.updateContent(creatorId, 'content-1', { title: 'x' })).rejects.toThrow(
          NotFoundException,
        );
      });

      it('should switch to PPV with a price and back', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue(ownContent);
        await service.updateContent(creatorId, 'content-1', { visibility: 'PPV' as any, ppvPrice: 7.5 });
        expect(mockPrismaService.content.update.mock.calls[0][0].data).toMatchObject({
          visibility: 'PPV',
          isPpv: true,
          ppvPrice: 7.5,
        });

        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, visibility: 'PPV', isPpv: true, ppvPrice: 7.5 });
        await service.updateContent(creatorId, 'content-1', { visibility: 'PUBLIC' as any });
        expect(mockPrismaService.content.update.mock.calls[1][0].data).toMatchObject({
          visibility: 'PUBLIC',
          isPpv: false,
          ppvPrice: null,
        });
      });

      it('should reject PPV without price', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue(ownContent);

        await expect(
          service.updateContent(creatorId, 'content-1', { visibility: 'PPV' as any }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should only schedule drafts', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, status: 'PUBLISHED' });

        await expect(
          service.updateContent(creatorId, 'content-1', { scheduledFor: new Date(Date.now() + 3600_000) }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should clear the schedule with null', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, scheduledFor: new Date() });

        await service.updateContent(creatorId, 'content-1', { scheduledFor: null });

        expect(mockPrismaService.content.update.mock.calls[0][0].data.scheduledFor).toBeNull();
      });
    });

    describe('publish / archive / unarchive / delete', () => {
      beforeEach(() => {
        mockPrismaService.content.update.mockImplementation(async ({ data }: any) => ({ ...ownContent, ...data }));
      });

      it('should send a draft to review and clear its schedule', async () => {
        mockPrismaService.user.findUnique.mockResolvedValue({ role: 'CREATOR', kycStatus: 'VERIFIED', status: 'ACTIVE' });
        mockPrismaService.contentFile.findMany.mockResolvedValue([{ scanStatus: 'CLEAN' }]);
        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, scheduledFor: new Date() });

        const result = await service.publishContent(creatorId, 'content-1');

        expect(result.status).toBe('UNDER_REVIEW');
        expect(mockPrismaService.content.update.mock.calls[0][0].data).toMatchObject({
          status: 'UNDER_REVIEW',
          scheduledFor: null,
        });
      });

      it('should not let content under review be published again', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, status: 'UNDER_REVIEW' });

        await expect(service.publishContent(creatorId, 'content-1')).rejects.toThrow(BadRequestException);
      });

      it('should archive published content only', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, status: 'PUBLISHED' });
        const result = await service.archiveContent(creatorId, 'content-1');
        expect(result.status).toBe('ARCHIVED');

        mockPrismaService.content.findUnique.mockResolvedValue(ownContent);
        await expect(service.archiveContent(creatorId, 'content-1')).rejects.toThrow(BadRequestException);
      });

      it('should unarchive and keep the original publication date', async () => {
        const publishedAt = new Date('2026-01-01');
        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, status: 'ARCHIVED', publishedAt });

        const result = await service.unarchiveContent(creatorId, 'content-1');

        expect(result.status).toBe('PUBLISHED');
        expect(mockPrismaService.content.update.mock.calls[0][0].data.publishedAt).toBe(publishedAt);
      });

      it('should forbid archiving or deleting content of another creator', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue({ ...ownContent, creatorId: 'other', status: 'PUBLISHED' });

        await expect(service.archiveContent(creatorId, 'content-1')).rejects.toThrow(ForbiddenException);
        await expect(service.deleteContent(creatorId, 'content-1')).rejects.toThrow(ForbiddenException);
        expect(mockPrismaService.content.update).not.toHaveBeenCalled();
      });

      it('should soft delete own content', async () => {
        mockPrismaService.content.findUnique.mockResolvedValue(ownContent);

        await service.deleteContent(creatorId, 'content-1');

        expect(mockPrismaService.content.update).toHaveBeenCalledWith({
          where: { id: 'content-1' },
          data: { deletedAt: expect.any(Date) },
        });
      });
    });

    describe('publishScheduledContent', () => {
      it('should publish due drafts', async () => {
        mockPrismaService.content.findMany.mockResolvedValue([{ id: 'content-1', creatorId }]);
        mockPrismaService.content.updateMany.mockResolvedValue({ count: 1 });

        const published = await service.publishScheduledContent();

        expect(published).toBe(1);
        expect(mockPrismaService.content.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['content-1'] }, status: 'DRAFT' },
          data: { status: 'PUBLISHED', publishedAt: expect.any(Date), scheduledFor: null },
        });
        expect(mockPrismaService.creatorProfile.updateMany).toHaveBeenCalledTimes(1);
      });

      it('should do nothing when nothing is due', async () => {
        mockPrismaService.content.findMany.mockResolvedValue([]);

        expect(await service.publishScheduledContent()).toBe(0);
        expect(mockPrismaService.content.updateMany).not.toHaveBeenCalled();
      });
    });
  });
});
