import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';

const PARTICIPANT_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
} as const;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MessagingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Whether `senderId` may send a direct message to `recipientId`.
   * A creator who disabled messages (CreatorProfile.allowMessages = false) can
   * only be messaged back by people they already wrote to; admins are exempt.
   */
  async canMessage(senderId: string, recipientId: string): Promise<boolean> {
    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: { role: true, creatorProfile: { select: { allowMessages: true } } },
    });

    if (!recipient || recipient.role !== 'CREATOR' || recipient.creatorProfile?.allowMessages !== false) {
      return true;
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { role: true },
    });
    if (sender?.role === 'ADMIN') {
      return true;
    }

    const creatorWroteFirst = await this.prisma.message.count({
      where: { senderId: recipientId, receiverId: senderId },
    });
    return creatorWroteFirst > 0;
  }

  /**
   * Open the conversation with a user (by id or username), creating it if needed.
   * Used by the "Message" button of profiles (/messages?user=...).
   */
  async startConversation(userId: string, userRef: string) {
    const ref = userRef.trim().replace(/^@/, '');
    if (!ref) {
      throw new BadRequestException('User is required');
    }

    const partner = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: UUID_REGEX.test(ref) ? [{ id: ref }, { username: ref }] : [{ username: ref }],
      },
      select: {
        ...PARTICIPANT_SELECT,
        role: true,
        status: true,
        creatorProfile: { select: { allowMessages: true } },
      },
    });

    if (!partner || partner.status === 'BANNED') {
      throw new NotFoundException('User not found');
    }
    if (partner.id === userId) {
      throw new BadRequestException('You cannot message yourself');
    }

    let conversation = await this.prisma.conversation.findFirst({
      where: {
        OR: [
          { participant1Id: userId, participant2Id: partner.id },
          { participant1Id: partner.id, participant2Id: userId },
        ],
      },
      include: {
        lastMessage: {
          select: { id: true, content: true, createdAt: true, status: true, senderId: true },
        },
      },
    });

    const canMessage = await this.canMessage(userId, partner.id);

    if (!conversation) {
      if (!canMessage) {
        throw new ForbiddenException("Ce créateur n'accepte pas les messages");
      }
      try {
        conversation = await this.prisma.conversation.create({
          data: { participant1Id: userId, participant2Id: partner.id },
          include: {
            lastMessage: {
              select: { id: true, content: true, createdAt: true, status: true, senderId: true },
            },
          },
        });
      } catch (error: any) {
        // Created concurrently (unique pair): reuse it
        if (error?.code !== 'P2002') {
          throw error;
        }
        conversation = await this.prisma.conversation.findFirst({
          where: { participant1Id: userId, participant2Id: partner.id },
          include: {
            lastMessage: {
              select: { id: true, content: true, createdAt: true, status: true, senderId: true },
            },
          },
        });
      }
    }

    const { id, username, displayName, avatar } = partner;

    return {
      id: conversation!.id,
      participant: { id, username, displayName, avatar },
      lastMessage: conversation!.lastMessage ?? null,
      updatedAt: conversation!.updatedAt,
      unreadCount: 0,
      canMessage,
    };
  }

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
            displayName: true,
            avatar: true,
          },
        },
        participant2: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        lastMessage: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            status: true,
            senderId: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Transform to include the "other" participant
    return conversations.map((conv: any) => {
      const otherParticipant =
        conv.participant1Id === userId ? conv.participant2 : conv.participant1;

      return {
        id: conv.id,
        participant: otherParticipant,
        lastMessage: conv.lastMessage,
        updatedAt: conv.updatedAt,
        unreadCount: conv.lastMessage?.senderId !== userId && conv.lastMessage?.status !== 'READ' ? 1 : 0,
      };
    });
  }

  async getMessages(userId: string, partnerId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId, receiverId: partnerId },
            { senderId: partnerId, receiverId: userId },
          ],
        },
        select: {
          id: true,
          content: true,
          senderId: true,
          receiverId: true,
          createdAt: true,
          status: true,
          hasAttachment: true,
          attachmentUrl: true,
          sender: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
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
            { senderId: userId, receiverId: partnerId },
            { senderId: partnerId, receiverId: userId },
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

  /**
   * Persist a direct message and keep the conversation's last message in sync
   */
  async sendMessage(
    senderId: string,
    receiverId: string,
    content: string,
    attachmentUrl?: string,
  ) {
    if (senderId === receiverId) {
      throw new BadRequestException('You cannot message yourself');
    }
    if (!(await this.canMessage(senderId, receiverId))) {
      throw new ForbiddenException("Ce créateur n'accepte pas les messages");
    }

    const message = await this.prisma.message.create({
      data: {
        senderId,
        receiverId,
        content,
        status: 'SENT',
        hasAttachment: !!attachmentUrl,
        attachmentUrl: attachmentUrl || null,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    await this.updateConversation(senderId, receiverId, message.id);

    return message;
  }

  private async updateConversation(userId1: string, userId2: string, lastMessageId: string) {
    // Find existing conversation
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        OR: [
          { participant1Id: userId1, participant2Id: userId2 },
          { participant1Id: userId2, participant2Id: userId1 },
        ],
      },
    });

    if (conversation) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageId,
          updatedAt: new Date(),
        },
      });
    } else {
      await this.prisma.conversation.create({
        data: {
          participant1Id: userId1,
          participant2Id: userId2,
          lastMessageId,
        },
      });
    }
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
