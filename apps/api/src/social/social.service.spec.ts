import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SocialService } from './social.service';
import { PrismaService } from '../common/database/prisma.service';

describe('SocialService', () => {
  let service: SocialService;

  const mockPrismaService = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
    },
    follow: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    creatorProfile: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SocialService>(SocialService);

    jest.resetAllMocks();
  });

  describe('searchCreators', () => {
    it('should search active creators by username or display name', async () => {
      const creators = [{ id: 'creator-1', username: 'alice', role: 'CREATOR' }];
      mockPrismaService.user.findMany.mockResolvedValue(creators);

      const result = await service.searchCreators({ q: ' ali ', limit: 5 });

      expect(result).toBe(creators);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'CREATOR',
            status: 'ACTIVE',
            OR: [
              { username: { contains: 'ali', mode: 'insensitive' } },
              { displayName: { contains: 'ali', mode: 'insensitive' } },
            ],
          }),
          take: 5,
        }),
      );
    });

    it('should return an empty list for a blank query', async () => {
      const result = await service.searchCreators({ q: '   ' });

      expect(result).toEqual([]);
      expect(mockPrismaService.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('discoverCreators', () => {
    it('should expose the cheapest active tier price and follow status', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'creator-1', username: 'alice', subscriptionTiers: [{ price: '9.99' }] },
        { id: 'creator-2', username: 'bob', subscriptionTiers: [] },
      ]);
      mockPrismaService.user.count.mockResolvedValue(2);
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { tier: { creatorId: 'creator-1' } },
      ]);
      mockPrismaService.follow.findMany.mockResolvedValue([{ creatorId: 'creator-2' }]);

      const result = await service.discoverCreators('user-1', {});

      expect(result.items).toEqual([
        { id: 'creator-1', username: 'alice', subscriptionPrice: 9.99, isSubscribed: true, isFollowing: false },
        { id: 'creator-2', username: 'bob', subscriptionPrice: null, isSubscribed: false, isFollowing: true },
      ]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    });
  });

  describe('follow', () => {
    const userId = 'fan-1';
    const creatorId = 'creator-1';

    beforeEach(() => {
      mockPrismaService.user.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === creatorId
            ? { id: creatorId, role: 'CREATOR', deletedAt: null }
            : { id: userId, username: 'bob', displayName: 'Bob' },
        ),
      );
      mockPrismaService.follow.count.mockResolvedValue(1);
      mockPrismaService.notification.create.mockResolvedValue({});
    });

    it('creates a follow row and notifies the creator once', async () => {
      mockPrismaService.follow.findUnique.mockResolvedValue(null);
      mockPrismaService.follow.create.mockResolvedValue({ id: 'f-1' });

      const result = await service.followCreator(userId, { creatorId });

      expect(mockPrismaService.follow.create).toHaveBeenCalledWith({
        data: { followerId: userId, creatorId },
      });
      expect(mockPrismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: creatorId,
          type: 'NEW_FOLLOWER',
          message: 'Bob vous suit maintenant',
          linkUrl: '/bob',
          metadata: { kind: 'NEW_FOLLOWER', followerId: userId },
        }),
      });
      expect(result).toEqual(expect.objectContaining({ isFollowing: true, followersCount: 1, creatorId }));
    });

    it('never touches totalSubscribers', async () => {
      mockPrismaService.follow.findUnique.mockResolvedValue(null);
      mockPrismaService.follow.create.mockResolvedValue({ id: 'f-1' });
      mockPrismaService.follow.deleteMany.mockResolvedValue({ count: 1 });

      await service.followCreator(userId, { creatorId });
      await service.unfollowCreator(userId, creatorId);

      expect(mockPrismaService.creatorProfile.update).not.toHaveBeenCalled();
      expect(mockPrismaService.creatorProfile.updateMany).not.toHaveBeenCalled();
    });

    it('is idempotent when already following', async () => {
      mockPrismaService.follow.findUnique.mockResolvedValue({ id: 'f-1' });

      const result = await service.followCreator(userId, { creatorId });

      expect(mockPrismaService.follow.create).not.toHaveBeenCalled();
      expect(mockPrismaService.notification.create).not.toHaveBeenCalled();
      expect(result.isFollowing).toBe(true);
    });

    it('does not notify twice on a concurrent duplicate follow', async () => {
      mockPrismaService.follow.findUnique.mockResolvedValue(null);
      mockPrismaService.follow.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(service.followCreator(userId, { creatorId })).resolves.toEqual(
        expect.objectContaining({ isFollowing: true }),
      );
      expect(mockPrismaService.notification.create).not.toHaveBeenCalled();
    });

    it('rejects following yourself or a non-creator', async () => {
      await expect(service.followCreator(creatorId, { creatorId })).rejects.toThrow(BadRequestException);

      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'x', role: 'SUBSCRIBER', deletedAt: null });
      await expect(service.followCreator(userId, { creatorId: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('unfollows by deleting the row', async () => {
      mockPrismaService.follow.deleteMany.mockResolvedValue({ count: 1 });
      mockPrismaService.follow.count.mockResolvedValue(0);

      const result = await service.unfollowCreator(userId, creatorId);

      expect(mockPrismaService.follow.deleteMany).toHaveBeenCalledWith({
        where: { followerId: userId, creatorId },
      });
      expect(result).toEqual(expect.objectContaining({ isFollowing: false, followersCount: 0 }));
    });

    it('returns the follow status', async () => {
      const followedAt = new Date();
      mockPrismaService.follow.findUnique.mockResolvedValue({ createdAt: followedAt });
      mockPrismaService.follow.count.mockResolvedValue(5);

      await expect(service.getFollowStatus(userId, creatorId)).resolves.toEqual({
        creatorId,
        isFollowing: true,
        followedAt,
        followersCount: 5,
      });
    });

    it('lists followed creators with subscription status', async () => {
      const followedAt = new Date();
      mockPrismaService.follow.findMany.mockResolvedValue([
        {
          creatorId: 'creator-1',
          createdAt: followedAt,
          creator: { id: 'creator-1', username: 'alice', _count: { followers: 3 } },
        },
        {
          creatorId: 'creator-2',
          createdAt: followedAt,
          creator: { id: 'creator-2', username: 'carol', _count: { followers: 1 } },
        },
      ]);
      mockPrismaService.subscription.findMany.mockResolvedValue([{ tier: { creatorId: 'creator-2' } }]);

      const result = await service.getFollowing(userId);

      expect(mockPrismaService.follow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { followerId: userId, creator: { deletedAt: null } } }),
      );
      expect(result).toEqual({
        total: 2,
        items: [
          { id: 'creator-1', username: 'alice', followersCount: 3, followedAt, isFollowing: true, isSubscribed: false },
          { id: 'creator-2', username: 'carol', followersCount: 1, followedAt, isFollowing: true, isSubscribed: true },
        ],
      });
    });
  });
});
