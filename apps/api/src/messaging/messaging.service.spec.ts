import { Test, TestingModule } from '@nestjs/testing';
import { MessagingService } from './messaging.service';
import { PrismaService } from '../common/database/prisma.service';

describe('MessagingService', () => {
  let service: MessagingService;

  const mockPrismaService = {
    message: {
      create: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
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

    jest.clearAllMocks();
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
  });
});
