import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../common/database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MessagingService } from '../messaging/messaging.service';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrismaService = {
    user: { findUnique: jest.fn() },
    subscription: { findMany: jest.fn() },
    content: { count: jest.fn() },
    liveStream: { findFirst: jest.fn() },
    story: { count: jest.fn() },
  };

  const mockMessagingService = {
    canMessage: jest.fn(),
  };

  const creator = {
    id: 'creator-1',
    username: 'alice',
    displayName: 'Alice',
    bio: null,
    avatar: null,
    coverImage: null,
    location: null,
    website: null,
    role: 'CREATOR',
    status: 'ACTIVE',
    kycStatus: 'VERIFIED',
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    creatorProfile: {
      averageRating: '4.80',
      allowMessages: false,
      allowTips: true,
      minimumTip: '5.00',
    },
    _count: { followers: 3 },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MessagingService, useValue: mockMessagingService },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    jest.resetAllMocks();
    mockPrismaService.subscription.findMany.mockResolvedValue([{ subscriberId: 'a' }, { subscriberId: 'b' }]);
    mockPrismaService.content.count.mockResolvedValue(7);
    mockPrismaService.liveStream.findFirst.mockResolvedValue(null);
    mockPrismaService.story.count.mockResolvedValue(0);
    mockMessagingService.canMessage.mockResolvedValue(true);
  });

  describe('findByUsername', () => {
    it('throws NotFound for unknown, banned or deleted users', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.findByUsername('nobody', 'viewer')).rejects.toBeInstanceOf(NotFoundException);

      mockPrismaService.user.findUnique.mockResolvedValueOnce({ ...creator, status: 'BANNED' });
      await expect(service.findByUsername('alice', 'viewer')).rejects.toBeInstanceOf(NotFoundException);

      mockPrismaService.user.findUnique.mockResolvedValueOnce({ ...creator, deletedAt: new Date() });
      await expect(service.findByUsername('alice', 'viewer')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns live counters, tip settings and viewer flags for a creator', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(creator);
      mockPrismaService.liveStream.findFirst.mockResolvedValue({ id: 'live-1', title: 'Live' });
      // active stories, then stories the viewer has not seen
      mockPrismaService.story.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
      mockMessagingService.canMessage.mockResolvedValue(false);

      const profile = await service.findByUsername('alice', 'viewer');

      expect(profile).toMatchObject({
        id: 'creator-1',
        isVerified: true,
        followersCount: 3,
        creatorProfile: {
          totalSubscribers: 2,
          totalContent: 7,
          averageRating: 4.8,
          allowMessages: false,
          allowTips: true,
          minimumTip: 5,
        },
        liveStream: { id: 'live-1', title: 'Live' },
        hasActiveStories: true,
        hasUnseenStories: true,
        canMessage: false,
      });
      expect(profile).not.toHaveProperty('status');
      expect(profile).not.toHaveProperty('kycStatus');
      expect(mockMessagingService.canMessage).toHaveBeenCalledWith('viewer', 'creator-1');
      // Private publications are hidden from other viewers
      expect(mockPrismaService.content.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ visibility: { not: 'PRIVATE' } }),
      });
      expect(mockPrismaService.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tier: { creatorId: 'creator-1' }, status: 'ACTIVE' } }),
      );
    });

    it('counts private publications and skips viewer flags on the own profile', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(creator);

      const profile = await service.findByUsername('alice', 'creator-1');

      expect(profile.canMessage).toBe(false);
      expect(profile.hasUnseenStories).toBe(false);
      expect(mockMessagingService.canMessage).not.toHaveBeenCalled();
      expect(mockPrismaService.content.count).toHaveBeenCalledWith({
        where: { creatorId: 'creator-1', status: 'PUBLISHED', deletedAt: null },
      });
      // only the active stories count, no "unseen" query
      expect(mockPrismaService.story.count).toHaveBeenCalledTimes(1);
    });

    it('returns no creator data for a regular user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...creator,
        role: 'SUBSCRIBER',
        kycStatus: 'NOT_STARTED',
        creatorProfile: null,
      });

      const profile = await service.findByUsername('alice', 'viewer');

      expect(profile).toMatchObject({
        creatorProfile: null,
        isVerified: false,
        liveStream: null,
        hasActiveStories: false,
        canMessage: true,
      });
      expect(mockPrismaService.subscription.findMany).not.toHaveBeenCalled();
    });
  });
});
