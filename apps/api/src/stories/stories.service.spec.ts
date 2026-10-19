import { Test, TestingModule } from '@nestjs/testing';
import { StoriesService } from './stories.service';
import { PrismaService } from '../common/database/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { MessagingGateway } from '../messaging/messaging.gateway';
import { StorageService } from '../storage/storage.service';
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
    follow: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockStorageService = {
    getSignedUrl: jest.fn(async (key: string) =>
      /^https?:\/\//.test(key) ? key : `https://signed.example.com/${key}`,
    ),
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
        { provide: StorageService, useValue: mockStorageService },
        { provide: MessagingService, useValue: mockMessagingService },
        { provide: MessagingGateway, useValue: mockMessagingGateway },
      ],
    }).compile();

    service = module.get<StoriesService>(StoriesService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
    mockPrismaService.storyLike.findMany.mockResolvedValue([]);
    mockPrismaService.storyView.findMany.mockResolvedValue([]);
    mockPrismaService.subscription.findMany.mockResolvedValue([]);
    mockPrismaService.follow.findMany.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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

      expect(result).toMatchObject({
        id: 'story-123',
        mediaUrl: 'https://example.com/image.jpg',
        isOwn: true,
        isLocked: false,
      });
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
        visibility: 'PUBLIC',
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
        visibility: 'PUBLIC',
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
        visibility: 'PUBLIC',
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
      visibility: 'PUBLIC',
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
      visibility: 'PUBLIC',
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

  describe('createStory media ownership', () => {
    const userId = 'creator-123';

    beforeEach(() => {
      mockPrismaService.user.findUnique.mockResolvedValue({ role: 'CREATOR' });
    });

    it('should accept a storage key from the creator folder and sign it on output', async () => {
      const key = `users/${userId}/images/2026/10/abc.jpg`;
      mockPrismaService.story.create.mockImplementation(async ({ data }: any) => ({
        id: 'story-1',
        ...data,
        creator: { id: userId },
        _count: { views: 0, likes: 0 },
      }));

      const result: any = await service.createStory(userId, {
        type: 'PHOTO' as any,
        mediaUrl: key,
        visibility: 'PUBLIC' as any,
      });

      expect(mockPrismaService.story.create.mock.calls[0][0].data.mediaUrl).toBe(key);
      expect(result.mediaUrl).toBe(`https://signed.example.com/${key}`);
    });

    it('should reject a storage key belonging to another user', async () => {
      await expect(
        service.createStory(userId, {
          type: 'PHOTO' as any,
          mediaUrl: 'users/someone-else/images/2026/10/abc.jpg',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.story.create).not.toHaveBeenCalled();
    });

    it('should store the background color of text stories only', async () => {
      mockPrismaService.story.create.mockImplementation(async ({ data }: any) => ({
        id: 'story-2',
        ...data,
        creator: { id: userId },
      }));

      await service.createStory(userId, {
        type: 'TEXT' as any,
        text: '  Bonjour  ',
        backgroundColor: '#ff0066',
        mediaUrl: 'users/someone-else/x.jpg',
      });

      const data = mockPrismaService.story.create.mock.calls[0][0].data;
      expect(data.text).toBe('Bonjour');
      expect(data.backgroundColor).toBe('#ff0066');
      expect(data.mediaUrl).toBeNull();
    });
  });

  describe('visibility enforcement', () => {
    const creatorId = 'creator-1';
    const viewerId = 'fan-1';
    const base = {
      creatorId,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      deletedAt: null,
      createdAt: new Date(),
      creator: { id: creatorId, username: 'alice' },
      _count: { views: 0, likes: 0 },
    };
    const publicStory = { ...base, id: 's-public', type: 'PHOTO', visibility: 'PUBLIC', mediaUrl: 'https://cdn/p.jpg', caption: 'Hello' };
    const subStory = { ...base, id: 's-sub', type: 'PHOTO', visibility: 'SUBSCRIBERS_ONLY', mediaUrl: 'https://cdn/s.jpg', caption: 'Secret' };

    it('should lock subscriber-only stories for non-subscribers', async () => {
      mockPrismaService.story.findMany.mockResolvedValue([publicStory, subStory]);

      const result: any[] = await service.getCreatorStories(creatorId, viewerId);

      expect(result[0]).toMatchObject({ id: 's-public', isLocked: false, mediaUrl: 'https://cdn/p.jpg' });
      expect(result[1]).toMatchObject({ id: 's-sub', isLocked: true, mediaUrl: null, caption: null });
      expect(mockPrismaService.story.findMany.mock.calls[0][0].where.visibility).toEqual({ not: 'PRIVATE' });
    });

    it('should unlock subscriber-only stories for active subscribers', async () => {
      mockPrismaService.story.findMany.mockResolvedValue([subStory]);
      mockPrismaService.subscription.findMany.mockResolvedValue([{ tier: { creatorId } }]);
      mockPrismaService.storyView.findMany.mockResolvedValue([{ storyId: 's-sub' }]);

      const [story]: any[] = await service.getCreatorStories(creatorId, viewerId);

      expect(story).toMatchObject({ isLocked: false, mediaUrl: 'https://cdn/s.jpg', isViewed: true });
    });

    it('should refuse views, likes and replies on locked stories', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue({ ...subStory });

      await expect(service.viewStory(viewerId, 's-sub')).rejects.toThrow(ForbiddenException);
      await expect(service.toggleLike(viewerId, 's-sub')).rejects.toThrow(ForbiddenException);
      await expect(service.replyToStory(viewerId, 's-sub', 'hi')).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.storyView.create).not.toHaveBeenCalled();
      expect(mockPrismaService.storyLike.create).not.toHaveBeenCalled();
      expect(mockMessagingService.sendMessage).not.toHaveBeenCalled();
    });

    it('should hide private stories from other users', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue({ ...publicStory, visibility: 'PRIVATE' });

      await expect(service.getStoryById('s-public', viewerId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStoriesFeed', () => {
    const userId = 'fan-1';

    it('should group stories by creator with unseen groups first', async () => {
      const now = Date.now();
      const story = (id: string, creatorId: string, minutesAgo: number) => ({
        id,
        creatorId,
        visibility: 'PUBLIC',
        type: 'TEXT',
        text: id,
        createdAt: new Date(now - minutesAgo * 60000),
        expiresAt: new Date(now + 3600 * 1000),
        creator: { id: creatorId },
      });
      mockPrismaService.subscription.findMany.mockResolvedValue([{ tier: { creatorId: 'c-seen' } }]);
      mockPrismaService.follow.findMany.mockResolvedValue([{ creatorId: 'c-new' }]);
      mockPrismaService.story.findMany.mockResolvedValue([
        story('a', 'c-seen', 30),
        story('b', 'c-new', 20),
        story('c', 'c-seen', 10),
      ]);
      mockPrismaService.storyView.findMany.mockResolvedValue([{ storyId: 'a' }, { storyId: 'c' }]);

      const groups: any[] = await service.getStoriesFeed(userId);

      expect(groups.map((g) => g.creator.id)).toEqual(['c-new', 'c-seen']);
      expect(groups[1].stories.map((s: any) => s.id)).toEqual(['a', 'c']);
      expect(groups[1].hasUnviewed).toBe(false);
      const where = mockPrismaService.story.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { creatorId: userId },
        { creatorId: { in: ['c-seen'] }, visibility: { not: 'PRIVATE' } },
        { creatorId: { in: ['c-new'] }, visibility: 'PUBLIC' },
      ]);
    });
  });

  describe('getStoryViewers', () => {
    it('should list viewers with their like status', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue({ creatorId: 'creator-1', deletedAt: null });
      mockPrismaService.storyView.findMany.mockResolvedValue([
        { viewerId: 'u1', viewer: { id: 'u1' } },
        { viewerId: 'u2', viewer: { id: 'u2' } },
      ]);
      mockPrismaService.storyView.count.mockResolvedValue(2);
      mockPrismaService.storyLike.findMany.mockResolvedValue([{ userId: 'u2' }]);

      const result = await service.getStoryViewers('creator-1', 'story-1');

      expect(result.total).toBe(2);
      expect(result.items.map((i: any) => i.hasLiked)).toEqual([false, true]);
    });

    it('should forbid other users', async () => {
      mockPrismaService.story.findUnique.mockResolvedValue({ creatorId: 'creator-1', deletedAt: null });

      await expect(service.getStoryViewers('fan-1', 'story-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
