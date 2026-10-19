import { Test, TestingModule } from '@nestjs/testing';
import { ContentService } from './content.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/database/prisma.service';
import { OneTimePaymentService } from '../payments/one-time-payment.service';
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
        { provide: OneTimePaymentService, useValue: mockOneTimePayments },
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
      status: 'requires_payment_method',
      completed: false,
      transactionId: 'tx-1',
      paymentIntentId: 'pi_123',
      clientSecret: 'secret_123',
      amount: 10,
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
          paymentMethodId: undefined,
        }),
      );
      // Nothing is granted before Stripe confirms the payment
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
        clientSecret: null,
      });

      const result = await service.unlockContent(userId, contentId, 'pm_1');

      expect(mockOneTimePayments.startPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethodId: 'pm_1' }),
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
        paymentIntentId: 'pi_123',
        clientSecret: null,
        amount: 10,
      });

      const result = await service.confirmUnlock('user-123', 'content-456', 'pi_123');

      expect(mockOneTimePayments.confirmPayment).toHaveBeenCalledWith('user-123', 'pi_123', {
        kind: 'content_unlock',
        contentId: 'content-456',
      });
      expect(result).toEqual(expect.objectContaining({ unlocked: true, contentId: 'content-456' }));
    });
  });
});
