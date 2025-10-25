import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';

@Injectable()
export class MessagingService {
  constructor(private prisma: PrismaService) {}

  async getConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      include: {
        participant1: {
          select: {
            id: true,
            username: true,
            creatorProfile: {
              select: {
                displayName: true,
                profilePicture: true,
              },
            },
          },
        },
        participant2: {
          select: {
            id: true,
            username: true,
            creatorProfile: {
              select: {
                displayName: true,
                profilePicture: true,
              },
            },
          },
        },
        lastMessage: {
          select: {
            id: true,
            content: true,
            type: true,
            createdAt: true,
            isRead: true,
            senderId: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Transform to include the "other" participant
    return conversations.map(conv => {
      const otherParticipant =
        conv.participant1Id === userId ? conv.participant2 : conv.participant1;

      return {
        id: conv.id,
        participant: otherParticipant,
        lastMessage: conv.lastMessage,
        updatedAt: conv.updatedAt,
        unreadCount: conv.lastMessage?.senderId !== userId && !conv.lastMessage?.isRead ? 1 : 0,
      };
    });
  }

  async getMessages(userId: string, partnerId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId, recipientId: partnerId },
            { senderId: partnerId, recipientId: userId },
          ],
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              creatorProfile: {
                select: {
                  displayName: true,
                  profilePicture: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.message.count({
        where: {
          OR: [
            { senderId: userId, recipientId: partnerId },
            { senderId: partnerId, recipientId: userId },
          ],
        },
      }),
    ]);

    return {
      items: messages.reverse(), // Reverse to show oldest first
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async deleteMessage(messageId: string, userId: string) {
    // Only allow deletion of own messages
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        senderId: userId,
      },
    });

    if (!message) {
      throw new Error('Message not found or unauthorized');
    }

    await this.prisma.message.delete({
      where: { id: messageId },
    });

    return { success: true };
  }
}
