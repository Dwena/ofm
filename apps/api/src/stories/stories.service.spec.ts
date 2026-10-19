import { Test, TestingModule } from '@nestjs/testing';
import { StoriesService } from './stories.service';
import { PrismaService } from '../common/database/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { MessagingGateway } from '../messaging/messaging.gateway';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';

describe('StoriesService', () => {
  let service: StoriesService;
  let prisma: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
    story: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    storyView: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    storyLike: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    creatorProfile: {
      findUnique: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockMessagingService = {
    sendMessage: jest.fn(),
  };

  const mockMessagingGateway = {
    toMessagePayload: jest.fn(),
    emitNewMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoriesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        { provide: MessagingService, useValue: mockMessagingService },
        { provide: MessagingGateway, useValue: mockMessagingGateway },
      ],
    }).compile();

    service = module.get<StoriesService>(StoriesService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStoriesFeed', () => {
    it('groups stories by creator with viewed status, own and unseen groups first', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { tier: { creatorId: 'creator-a' } },
        { tier: { creatorId: 'creator-b' } },
        { tier: { creatorId: 'creator-a' } },
      ]);
      mockPrismaService.story.findMany.mockResolvedValue([
        { id: 's-a1', creatorId: 'creator-a', creator: { id: 'creator-a' }, views: [{ id: 'v1' }] },
        { id: 's-b1', creatorId: 'creator-b', creator: { id: 'creator-b' }, views: [] },
        { id: 's-own', creatorId: 'user-1', creator: { id: 'user-1' }, views: [] },
        { id: 's-a2', creatorId: 'creator-a', creator: { id: 'creator-a' }, views: [{ id: 'v2' }] },
      ]);

      const feed: any[] = await service.getStoriesFeed('user-1');

      expect(mockPrismaService.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            creatorId: { in: ['user-1', 'creator-a', 'creator-b'] },
            deletedAt: null,
          }),
          include: expect.objectContaining({
            views: { where: { viewerId: 'user-1' }, select: { id: true }, take: 1 },
          }),
        }),
      );
      expect(feed.map((g) => [g.creator.id, g.hasUnviewed, g.isOwn])).toEqual([
        ['user-1', false, true],
        ['creator-b', true, false],
        ['creator-a', false, false],
      ]);
      expect(feed[2].stories.map((s: any) => [s.id, s.isViewed])).toEqual([
        ['s-a1', true],
        ['s-a2', true],
      ]);
      expect(feed[1].stories[0]).not.toHaveProperty('views');
    });
  });

  describe('createStory', () => {
    const userId = 'creator-123';
    const dto = {
      type: 'PHOTO' as any,
      mediaUrl: 'https://example.com/image.jpg',
      caption: 'Test story',
    };

    it('should create a story for a creator', async () => {
      const mockUser = { role: 'CREATOR' };
      const mockStory = {
        id: 'story-123',
        creatorId: userId,
        ...dto,
        expiresAt: expect.any(Date),
        creator: {
          id: userId,
          username: 'creator',
          displayName: 'Creator User',
          avatar: null,
        },
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.story.create.mockResolvedValue(mockStory);

      const result = await service.createStory(userId, dto);

      expect(result).toEqual(mockStory);
      expect(mockPrismaService.story.create).toHaveBeenCalled();

      const createCall = mockPrismaService.story.create.mock.calls[0][0];
      expect(createCall.data.expiresAt).toBeInstanceOf(Date);

      // Check that expiration is ~24h from now
      const expiresAt = createCall.data.expiresAt;
      const now = new Date();
      const hoursDiff = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      expect(hoursDiff).toBeGreaterThan(23.9);
      expect(hoursDiff).toBeLessThan(24.1);
    });

    it('should throw ForbiddenException if user is not a creator', async () => {
      const mockUser = { role: 'SUBSCRIBER' };
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.createStory(userId, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if text story has no text', async () => {
      const mockUser = { role: 'CREATOR' };
      const invalidDto = { type: 'TEXT' as any };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.createStory(userId, invalidDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if image story has no mediaUrl', async () => {
      const mockUser = { role: 'CREATOR' };
      const invalidDto = { type: 'PHOTO' as any };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.createStory(userId, invalidDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('viewStory', () => {
    const userId = 'user-123';
    const storyId = 'story-456';

    it('should track view when user views a story', async () => {
      const mockStory = {
        id: storyId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        deletedAt: null,
        creatorId: 'creator-123',
      };

      mockPrismaService.story.findUnique.mockResolvedValue(mockStory);
      mockPrismaService.storyView.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockResolvedValue([
        { id: 'view-123' },
        { viewCount: 1 },
      ]);

      const result = await service.viewStory(userId, storyId);

      expect(result).toEqual({ message: 'Story view tracked' });
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should not track duplicate views', async () => {
      const mockStory = {
        id: storyId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        deletedAt: null,
        creatorId: 'creator-123',
      };
      const mockView = { id: 'view-123' };

      mockPrismaService.story.findUnique.mockResolvedValue(mockStory);
      mockPrismaService.storyView.findUnique.mockResolvedValue(mockView);

      const result = await service.viewStory(userId, storyId);

      expect(result).toEqual({ message: 'Story view tracked' });
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if story is expired', async () => {
      const mockStory = {
        id: storyId,
        expiresAt: new Date(Date.now() - 1000), // Expired
        deletedAt: null,
        creatorId: 'creator-123',
      };

      mockPrismaService.story.findUnique.mockResolvedValue(mockStory);

      await expect(service.viewStory(userId, storyId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteStory', () => {
    const userId = 'creator-123';
    const storyId = 'story-456';

    it('should delete own story', async () => {
      const mockStory = { creatorId: userId };

      mockPrismaService.story.findUnique.mockResolvedValue(mockStory);
      mockPrismaService.story.update.mockResolvedValue({ deletedAt: new Date() });

      const result = await service.deleteStory(userId, storyId);

      expect(result).toEqual({ message: 'Story deleted successfully' });
      expect(mockPrismaService.story.update).toHaveBeenCalledWith({
        where: { id: storyId },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw ForbiddenException when deleting someone else\'s story', async () => {
      const mockStory = { creatorId: 'other-creator' };

      mockPrismaService.story.findUnique.mockResolvedValue(mockStory);

      await expect(service.deleteStory(userId, storyId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException if story not found', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue(null);

      await expect(service.deleteStory(userId, storyId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('toggleLike', () => {
    const userId = 'user-123';
    const storyId = 'story-456';
    const activeStory = {
      id: storyId,
      creatorId: 'creator-1',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      deletedAt: null,
    };

    it('should like a story that is not yet liked', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue(activeStory);
      mockPrismaService.storyLike.findUnique.mockResolvedValue(null);
      mockPrismaService.storyLike.count.mockResolvedValue(1);

      const result = await service.toggleLike(userId, storyId);

      expect(mockPrismaService.storyLike.create).toHaveBeenCalledWith({
        data: { storyId, userId },
      });
      expect(result).toEqual({ liked: true, likesCount: 1 });
    });

    it('should unlike a story that is already liked', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue(activeStory);
      mockPrismaService.storyLike.findUnique.mockResolvedValue({ id: 'like-1' });
      mockPrismaService.storyLike.count.mockResolvedValue(0);

      const result = await service.toggleLike(userId, storyId);

      expect(mockPrismaService.storyLike.delete).toHaveBeenCalledWith({
        where: { id: 'like-1' },
      });
      expect(result).toEqual({ liked: false, likesCount: 0 });
    });

    it('should throw NotFoundException if story is expired', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue({
        ...activeStory,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.toggleLike(userId, storyId)).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.storyLike.create).not.toHaveBeenCalled();
    });
  });

  describe('replyToStory', () => {
    const userId = 'user-123';
    const storyId = 'story-456';
    const activeStory = {
      id: storyId,
      creatorId: 'creator-1',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      deletedAt: null,
    };

    it('should send the reply as a direct message to the creator', async () => {
      const message = { id: 'msg-1', senderId: userId, receiverId: 'creator-1' };
      mockPrismaService.story.findUnique.mockResolvedValue(activeStory);
      mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ allowMessages: true });
      mockMessagingService.sendMessage.mockResolvedValue(message);
      mockMessagingGateway.toMessagePayload.mockReturnValue({ id: 'msg-1' });

      const result = await service.replyToStory(userId, storyId, '  Super story !  ');

      expect(mockMessagingService.sendMessage).toHaveBeenCalledWith(
        userId,
        'creator-1',
        '[Réponse à votre story] Super story !',
      );
      expect(mockMessagingGateway.emitNewMessage).toHaveBeenCalledWith('creator-1', { id: 'msg-1' });
      expect(result).toBe(message);
    });

    it('should not allow replying to own story', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue(activeStory);

      await expect(service.replyToStory('creator-1', storyId, 'hi')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockMessagingService.sendMessage).not.toHaveBeenCalled();
    });

    it('should respect creators who disabled messages', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue(activeStory);
      mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ allowMessages: false });

      await expect(service.replyToStory(userId, storyId, 'hi')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockMessagingService.sendMessage).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if story not found', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue(null);

      await expect(service.replyToStory(userId, storyId, 'hi')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
