import { Test, TestingModule } from '@nestjs/testing';
import { StoriesService } from './stories.service';
import { PrismaService } from '../common/database/prisma.service';
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
    subscription: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoriesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<StoriesService>(StoriesService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createStory', () => {
    const userId = 'creator-123';
    const dto = {
      type: 'IMAGE' as any,
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
      const hoursDiff = (expiresAt - now) / (1000 * 60 * 60);
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
      const invalidDto = { type: 'IMAGE' as any };

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
});
