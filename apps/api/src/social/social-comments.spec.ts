import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SocialService } from './social.service';
import { PrismaService } from '../common/database/prisma.service';
import { CreateCommentDto, UpdateCommentDto } from './dto/social.dto';

describe('SocialService comments', () => {
  let service: SocialService;

  const mockPrismaService = {
    content: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    comment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
  };

  const publishedContent = {
    id: 'content-1',
    creatorId: 'creator-1',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SocialService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<SocialService>(SocialService);
    jest.resetAllMocks();
  });

  describe('createComment', () => {
    it('creates the comment, bumps the counter and notifies the creator', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(publishedContent);
      mockPrismaService.comment.create.mockResolvedValue({
        id: 'comment-1',
        text: 'Super',
        user: { id: 'user-1', username: 'david', displayName: 'David' },
      });

      const result = await service.createComment('user-1', { contentId: 'content-1', text: 'Super' });

      expect(result.id).toBe('comment-1');
      expect(mockPrismaService.content.update).toHaveBeenCalledWith({
        where: { id: 'content-1' },
        data: { commentCount: { increment: 1 } },
      });
      expect(mockPrismaService.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'creator-1', linkUrl: '/content/content-1' }),
        }),
      );
    });

    it.each([
      ['a draft', { status: 'DRAFT' }],
      ['private content', { visibility: 'PRIVATE' }],
      ['deleted content', { deletedAt: new Date() }],
    ])('refuses to comment %s of another creator', async (_label, overrides) => {
      mockPrismaService.content.findUnique.mockResolvedValue({ ...publishedContent, ...overrides });

      await expect(
        service.createComment('user-1', { contentId: 'content-1', text: 'Hello' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrismaService.comment.create).not.toHaveBeenCalled();
    });

    it('lets the creator comment their own private content', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue({ ...publishedContent, visibility: 'PRIVATE' });
      mockPrismaService.comment.create.mockResolvedValue({
        id: 'comment-2',
        user: { id: 'creator-1', username: 'alice' },
      });

      await service.createComment('creator-1', { contentId: 'content-1', text: 'Note' });

      expect(mockPrismaService.comment.create).toHaveBeenCalled();
      expect(mockPrismaService.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('updateComment / deleteComment', () => {
    it('only lets the author edit a comment', async () => {
      mockPrismaService.comment.findUnique.mockResolvedValue({ id: 'c', userId: 'someone-else', deletedAt: null });

      await expect(service.updateComment('user-1', 'c', { text: 'x' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lets the content creator delete a comment and decrements the counter', async () => {
      mockPrismaService.comment.findUnique.mockResolvedValue({
        id: 'c',
        userId: 'user-1',
        contentId: 'content-1',
        deletedAt: null,
        content: { creatorId: 'creator-1' },
      });

      await service.deleteComment('creator-1', 'c');

      expect(mockPrismaService.comment.update).toHaveBeenCalledWith({
        where: { id: 'c' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockPrismaService.content.update).toHaveBeenCalledWith({
        where: { id: 'content-1' },
        data: { commentCount: { decrement: 1 } },
      });
    });
  });

  describe('comment DTO validation', () => {
    it('trims the text and rejects blank comments', async () => {
      const blank = plainToInstance(CreateCommentDto, { contentId: 'content-1', text: '   ' });
      expect(await validate(blank)).not.toHaveLength(0);

      const ok = plainToInstance(CreateCommentDto, { contentId: 'content-1', text: '  Bravo  ' });
      expect(await validate(ok)).toHaveLength(0);
      expect(ok.text).toBe('Bravo');
    });

    it('rejects comments longer than 500 characters', async () => {
      const tooLong = plainToInstance(UpdateCommentDto, { text: 'a'.repeat(501) });
      expect(await validate(tooLong)).not.toHaveLength(0);
    });
  });
});
