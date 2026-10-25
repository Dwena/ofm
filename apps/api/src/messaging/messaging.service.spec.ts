import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MessagingService } from './messaging.service';
import { PrismaService } from '../common/database/prisma.service';
import { PaymentFlowService } from '../payments/payment-flow.service';

describe('MessagingService', () => {
  let service: MessagingService;

  const mockPrismaService = {
    message: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockOneTimePayments = {
    startPayment: jest.fn(),
    confirmPayment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: PaymentFlowService,
          useValue: mockOneTimePayments,
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
      expect(result.lastMessage).toEqual({ id: 'm-1', locked: false });
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

  describe('sendMessage (PPV & validation)', () => {
    it('stores a PPV message sent by a creator', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ role: 'SUBSCRIBER', status: 'ACTIVE', deletedAt: null, creatorProfile: null })
        .mockResolvedValueOnce({ role: 'CREATOR' });
      mockPrismaService.message.create.mockResolvedValue({ id: 'msg-ppv' });
      mockPrismaService.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });

      await service.sendMessage('creator-1', 'fan-1', 'Photos exclusives', undefined, { ppvPrice: 9.99 });

      expect(mockPrismaService.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPpv: true, ppvPrice: 9.99, content: 'Photos exclusives' }),
        }),
      );
    });

    it('refuses PPV messages from non-creators and out-of-range prices', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ role: 'CREATOR', status: 'ACTIVE', creatorProfile: { allowMessages: true } })
        .mockResolvedValueOnce({ role: 'SUBSCRIBER' });
      await expect(
        service.sendMessage('fan-1', 'creator-1', 'Payant ?', undefined, { ppvPrice: 5 }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.sendMessage('creator-1', 'fan-1', 'Trop cher', undefined, { ppvPrice: 0.2 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.message.create).not.toHaveBeenCalled();
    });

    it('refuses empty messages and unknown or banned recipients', async () => {
      await expect(service.sendMessage('user-1', 'user-2', '   ')).rejects.toThrow(BadRequestException);

      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.sendMessage('user-1', 'ghost', 'Salut')).rejects.toThrow(NotFoundException);

      mockPrismaService.user.findUnique.mockResolvedValueOnce({ role: 'SUBSCRIBER', status: 'BANNED' });
      await expect(service.sendMessage('user-1', 'banned', 'Salut')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMessages', () => {
    const ppvMessage = {
      id: 'm-ppv',
      content: 'Mon guide secret',
      senderId: 'creator-1',
      receiverId: 'fan-1',
      hasAttachment: true,
      attachmentUrl: 'https://cdn.example/guide.jpg',
      isPpv: true,
      ppvPrice: 7.99,
      isPurchased: false,
      createdAt: new Date('2026-01-02'),
    };

    it('locks unpurchased PPV messages for the recipient only', async () => {
      mockPrismaService.message.findMany.mockResolvedValue([ppvMessage]);
      mockPrismaService.message.count.mockResolvedValue(1);

      const asFan = await service.getMessages('fan-1', 'creator-1');
      expect(asFan.items[0]).toEqual(
        expect.objectContaining({ locked: true, content: '', attachmentUrl: null, ppvPrice: 7.99 }),
      );
      expect(asFan.hasMore).toBe(false);

      mockPrismaService.message.findMany.mockResolvedValue([ppvMessage]);
      const asCreator = await service.getMessages('creator-1', 'fan-1');
      expect(asCreator.items[0]).toEqual(expect.objectContaining({ locked: false, content: 'Mon guide secret' }));
    });

    it('excludes deleted messages and pages with "before"', async () => {
      mockPrismaService.message.findMany.mockResolvedValue([{ ...ppvMessage, isPpv: false }]);
      mockPrismaService.message.count.mockResolvedValueOnce(80).mockResolvedValueOnce(30);
      const before = '2026-01-03T00:00:00.000Z';

      const result = await service.getMessages('fan-1', 'creator-1', 1, 20, before);

      expect(mockPrismaService.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null, createdAt: { lt: new Date(before) } }),
          skip: 0,
          take: 20,
        }),
      );
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getConversations', () => {
    it('returns real unread counts and hides locked PPV previews', async () => {
      mockPrismaService.conversation.findMany.mockResolvedValue([
        {
          id: 'conv-1',
          participant1Id: 'fan-1',
          participant2Id: 'creator-1',
          participant1: { id: 'fan-1', username: 'fan', role: 'SUBSCRIBER', creatorProfile: null },
          participant2: {
            id: 'creator-1',
            username: 'alice',
            displayName: 'Alice',
            avatar: null,
            role: 'CREATOR',
            creatorProfile: { allowMessages: true },
          },
          lastMessage: {
            id: 'm-1',
            content: 'Secret',
            senderId: 'creator-1',
            receiverId: 'fan-1',
            isPpv: true,
            isPurchased: false,
            deletedAt: null,
          },
          updatedAt: new Date(),
        },
      ]);
      mockPrismaService.message.groupBy.mockResolvedValue([{ senderId: 'creator-1', _count: { _all: 3 } }]);

      const [conversation] = await service.getConversations('fan-1');

      expect(conversation.participant).toEqual({ id: 'creator-1', username: 'alice', displayName: 'Alice', avatar: null });
      expect(conversation.unreadCount).toBe(3);
      expect(conversation.canMessage).toBe(true);
      expect(conversation.lastMessage).toEqual(expect.objectContaining({ locked: true, content: '' }));
    });
  });

  describe('markConversationRead', () => {
    it('marks the unread messages received from the partner', async () => {
      mockPrismaService.message.findMany.mockResolvedValue([{ id: 'm-1' }, { id: 'm-2' }]);

      const result = await service.markConversationRead('fan-1', 'creator-1');

      expect(mockPrismaService.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { senderId: 'creator-1', receiverId: 'fan-1', deletedAt: null, status: { not: 'READ' } },
        }),
      );
      expect(mockPrismaService.message.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['m-1', 'm-2'] } },
        data: { status: 'READ', readAt: expect.any(Date) },
      });
      expect(result).toEqual({ messageIds: ['m-1', 'm-2'], count: 2 });
    });
  });

  describe('deleteMessage', () => {
    it('soft-deletes your message and moves the conversation preview back', async () => {
      mockPrismaService.message.findFirst
        .mockResolvedValueOnce({ id: 'm-2', senderId: 'user-1', receiverId: 'user-2', isPpv: false })
        .mockResolvedValueOnce({ id: 'm-1' });
      mockPrismaService.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });

      const result = await service.deleteMessage('m-2', 'user-1');

      expect(mockPrismaService.message.update).toHaveBeenCalledWith({
        where: { id: 'm-2' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockPrismaService.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { lastMessageId: 'm-1' },
      });
      expect(result).toEqual({ success: true, messageId: 'm-2', receiverId: 'user-2' });
    });

    it("refuses other people's messages and purchased PPV messages", async () => {
      mockPrismaService.message.findFirst.mockResolvedValueOnce(null);
      await expect(service.deleteMessage('m-x', 'user-1')).rejects.toThrow(NotFoundException);

      mockPrismaService.message.findFirst.mockResolvedValueOnce({
        id: 'm-ppv',
        senderId: 'user-1',
        receiverId: 'user-2',
        isPpv: true,
        isPurchased: true,
      });
      await expect(service.deleteMessage('m-ppv', 'user-1')).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.message.update).not.toHaveBeenCalled();
    });
  });

  describe('unlockMessage', () => {
    const message = {
      id: 'm-ppv',
      senderId: 'creator-1',
      receiverId: 'fan-1',
      isPpv: true,
      ppvPrice: 7.99,
      isPurchased: false,
      deletedAt: null,
      sender: { id: 'creator-1', username: 'alice' },
    };

    it('starts a one-off payment for the recipient', async () => {
      mockPrismaService.message.findUnique.mockResolvedValue(message);
      mockOneTimePayments.startPayment.mockResolvedValue({
        status: 'requires_redirect',
        completed: false,
        transactionId: 'tx-1',
        redirectUrl: 'https://pay.example/checkout',
      });

      const result = await service.unlockMessage('fan-1', 'm-ppv', { paymentCardId: 'card-1', withdrawalWaiver: true });

      expect(mockOneTimePayments.startPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          payerId: 'fan-1',
          creatorId: 'creator-1',
          kind: 'message_unlock',
          amount: 7.99,
          paymentCardId: 'card-1',
          withdrawalWaiver: true,
          metadata: { messageId: 'm-ppv' },
        }),
      );
      expect(result).toEqual(expect.objectContaining({ unlocked: false, redirectUrl: 'https://pay.example/checkout', messageId: 'm-ppv' }));
    });

    it('does not charge twice, nor anyone but the recipient', async () => {
      mockPrismaService.message.findUnique.mockResolvedValueOnce({ ...message, isPurchased: true });
      await expect(service.unlockMessage('fan-1', 'm-ppv')).resolves.toEqual({
        unlocked: true,
        alreadyUnlocked: true,
        messageId: 'm-ppv',
      });

      mockPrismaService.message.findUnique.mockResolvedValueOnce(message);
      await expect(service.unlockMessage('someone-else', 'm-ppv')).rejects.toThrow(NotFoundException);

      mockPrismaService.message.findUnique.mockResolvedValueOnce({ ...message, isPpv: false, ppvPrice: null });
      await expect(service.unlockMessage('fan-1', 'm-ppv')).rejects.toThrow(BadRequestException);
      expect(mockOneTimePayments.startPayment).not.toHaveBeenCalled();
    });

    it('confirms against the message id', async () => {
      mockOneTimePayments.confirmPayment.mockResolvedValue({ status: 'completed', completed: true });

      const result = await service.confirmUnlockMessage('fan-1', 'm-ppv', 'tx-1');

      expect(mockOneTimePayments.confirmPayment).toHaveBeenCalledWith('fan-1', 'tx-1', {
        kind: 'message_unlock',
        metadata: { messageId: 'm-ppv' },
      });
      expect(result).toEqual(expect.objectContaining({ unlocked: true, messageId: 'm-ppv' }));
    });
  });

  describe('searchContacts', () => {
    it('lets fans search creators only', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({ role: 'SUBSCRIBER' });
      mockPrismaService.user.findMany.mockResolvedValue([
        {
          id: 'creator-1',
          username: 'alice',
          displayName: 'Alice',
          avatar: null,
          role: 'CREATOR',
          creatorProfile: { allowMessages: true },
        },
      ]);

      const result = await service.searchContacts('fan-1', 'ali');

      const where = mockPrismaService.user.findMany.mock.calls[0][0].where;
      expect(where.AND[0]).toEqual({ id: { not: 'fan-1' }, deletedAt: null, status: 'ACTIVE' });
      expect(where.AND[1].AND[1]).toEqual({ role: 'CREATOR' });
      expect(result).toEqual([
        { id: 'creator-1', username: 'alice', displayName: 'Alice', avatar: null, role: 'CREATOR', canMessage: true },
      ]);
    });
  });
});
