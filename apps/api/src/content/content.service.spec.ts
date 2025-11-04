import { Test, TestingModule } from '@nestjs/testing';
import { ContentService } from './content.service';
import { PrismaService } from '../common/database/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

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
    user: {
      findUnique: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
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
});
