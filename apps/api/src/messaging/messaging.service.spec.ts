import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MessagingService } from './messaging.service';
import { PrismaService } from '../common/database/prisma.service';

describe('MessagingService', () => {
  let service: MessagingService;

  const mockPrismaService = {
    message: {
      create: jest.fn(),
      count: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<MessagingService>(MessagingService);

    jest.resetAllMocks();
    // By default the recipient is a regular user (no messaging restriction)
    mockPrismaService.user.findUnique.mockResolvedValue({ role: 'SUBSCRIBER', creatorProfile: null });
    mockPrismaService.message.count.mockResolvedValue(0);
  });

  describe('sendMessage', () => {
    const senderId = 'user-1';
    const receiverId = 'user-2';

    it('should create the message and start a new conversation', async () => {
      const message = { id: 'msg-1', senderId, receiverId, content: 'Salut' };
      mockPrismaService.message.create.mockResolvedValue(message);
      mockPrismaService.conversation.findFirst.mockResolvedValue(null);

      const result = await service.sendMessage(senderId, receiverId, 'Salut');

      expect(result).toBe(message);
      expect(mockPrismaService.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderId,
            receiverId,
            content: 'Salut',
            hasAttachment: false,
            attachmentUrl: null,
          }),
        }),
      );
      expect(mockPrismaService.conversation.create).toHaveBeenCalledWith({
        data: {
          participant1Id: senderId,
          participant2Id: receiverId,
          lastMessageId: 'msg-1',
        },
      });
    });

    it('should update the existing conversation in either direction', async () => {
      mockPrismaService.message.create.mockResolvedValue({ id: 'msg-2' });
      mockPrismaService.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });

      await service.sendMessage(senderId, receiverId, 'Re', 'https://cdn.example/a.jpg');

      expect(mockPrismaService.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hasAttachment: true,
            attachmentUrl: 'https://cdn.example/a.jpg',
          }),
        }),
      );
      expect(mockPrismaService.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { lastMessageId: 'msg-2', updatedAt: expect.any(Date) },
      });
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
    });

    it('should refuse to message a creator who disabled messages', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ role: 'CREATOR', creatorProfile: { allowMessages: false } })
        .mockResolvedValueOnce({ role: 'SUBSCRIBER' });
      mockPrismaService.message.count.mockResolvedValue(0);

      await expect(service.sendMessage(senderId, receiverId, 'Salut')).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.message.create).not.toHaveBeenCalled();
    });

    it('should refuse to message yourself', async () => {
      await expect(service.sendMessage(senderId, senderId, 'Moi')).rejects.toThrow(BadRequestException);
    });
  });

  describe('canMessage', () => {
    it('allows replying to a creator who wrote first even if messages are disabled', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ role: 'CREATOR', creatorProfile: { allowMessages: false } })
        .mockResolvedValueOnce({ role: 'SUBSCRIBER' });
      mockPrismaService.message.count.mockResolvedValue(2);

      await expect(service.canMessage('fan-1', 'creator-1')).resolves.toBe(true);
      expect(mockPrismaService.message.count).toHaveBeenCalledWith({
        where: { senderId: 'creator-1', receiverId: 'fan-1' },
      });
    });

    it('lets admins message any creator', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ role: 'CREATOR', creatorProfile: { allowMessages: false } })
        .mockResolvedValueOnce({ role: 'ADMIN' });

      await expect(service.canMessage('admin-1', 'creator-1')).resolves.toBe(true);
      expect(mockPrismaService.message.count).not.toHaveBeenCalled();
    });

    it('allows creators that accept messages', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        role: 'CREATOR',
        creatorProfile: { allowMessages: true },
      });

      await expect(service.canMessage('fan-1', 'creator-1')).resolves.toBe(true);
    });
  });

  describe('startConversation', () => {
    const userId = 'user-1';
    const partnerId = '5f0c8a3e-1b2c-4d5e-8f90-123456789abc';
    const partner = {
      id: partnerId,
      username: 'alice',
      displayName: 'Alice',
      avatar: null,
      role: 'CREATOR',
      status: 'ACTIVE',
      creatorProfile: { allowMessages: true },
    };

    it('resolves a username and creates the conversation', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(partner);
      mockPrismaService.conversation.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({ role: 'CREATOR', creatorProfile: { allowMessages: true } });
      const now = new Date();
      mockPrismaService.conversation.create.mockResolvedValue({ id: 'conv-1', lastMessage: null, updatedAt: now });

      const result = await service.startConversation(userId, '@alice');

      expect(mockPrismaService.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, OR: [{ username: 'alice' }] },
        }),
      );
      expect(mockPrismaService.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { participant1Id: userId, participant2Id: partnerId } }),
      );
      expect(result).toEqual({
        id: 'conv-1',
        participant: { id: partnerId, username: 'alice', displayName: 'Alice', avatar: null },
        lastMessage: null,
        updatedAt: now,
        unreadCount: 0,
        canMessage: true,
      });
    });

    it('accepts an id and reuses the existing conversation', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(partner);
      mockPrismaService.conversation.findFirst.mockResolvedValue({
        id: 'conv-2',
        lastMessage: { id: 'm-1' },
        updatedAt: new Date(),
      });
      mockPrismaService.user.findUnique.mockResolvedValue({ role: 'CREATOR', creatorProfile: { allowMessages: true } });

      const result = await service.startConversation(userId, partnerId);

      expect(mockPrismaService.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, OR: [{ id: partnerId }, { username: partnerId }] },
        }),
      );
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
      expect(result.id).toBe('conv-2');
      expect(result.lastMessage).toEqual({ id: 'm-1' });
    });

    it('refuses to start a conversation with a creator who disabled messages', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({ ...partner, creatorProfile: { allowMessages: false } });
      mockPrismaService.conversation.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ role: 'CREATOR', creatorProfile: { allowMessages: false } })
        .mockResolvedValueOnce({ role: 'SUBSCRIBER' });
      mockPrismaService.message.count.mockResolvedValue(0);

      await expect(service.startConversation(userId, 'alice')).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
    });

    it('rejects unknown users and yourself', async () => {
      mockPrismaService.user.findFirst.mockResolvedValueOnce(null);
      await expect(service.startConversation(userId, 'nobody')).rejects.toThrow(NotFoundException);

      mockPrismaService.user.findFirst.mockResolvedValueOnce({ ...partner, id: userId });
      await expect(service.startConversation(userId, 'me')).rejects.toThrow(BadRequestException);
    });
  });
});
