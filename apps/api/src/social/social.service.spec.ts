import { Test, TestingModule } from '@nestjs/testing';
import { SocialService } from './social.service';
import { PrismaService } from '../common/database/prisma.service';

describe('SocialService', () => {
  let service: SocialService;

  const mockPrismaService = {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
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

    jest.clearAllMocks();
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

      const result = await service.discoverCreators('user-1', {});

      expect(result.items).toEqual([
        { id: 'creator-1', username: 'alice', subscriptionPrice: 9.99, isFollowing: true },
        { id: 'creator-2', username: 'bob', subscriptionPrice: null, isFollowing: false },
      ]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    });
  });
});
