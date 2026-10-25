import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { roundMoney } from '../common/utils/money';
import { PaymentFlowService, PurchaseOptions } from '../payments/payment-flow.service';
import { MESSAGE_MAX_LENGTH, MESSAGE_PPV_MAX_PRICE, MESSAGE_PPV_MIN_PRICE } from './dto/send-message.dto';

const PARTICIPANT_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
} as const;

const LAST_MESSAGE_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  status: true,
  senderId: true,
  receiverId: true,
  hasAttachment: true,
  isPpv: true,
  isPurchased: true,
  deletedAt: true,
} as const;

const MESSAGE_SELECT = {
  id: true,
  content: true,
  senderId: true,
  receiverId: true,
  createdAt: true,
  status: true,
  readAt: true,
  hasAttachment: true,
  attachmentUrl: true,
  isPpv: true,
  ppvPrice: true,
  isPurchased: true,
  sender: { select: PARTICIPANT_SELECT },
} as const;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RecipientInfo = {
  role: string;
  status?: string | null;
  deletedAt?: Date | null;
  creatorProfile?: { allowMessages: boolean } | null;
} | null;

type MessageLike = {
  id: string;
  content: string;
  senderId: string;
  receiverId: string;
  hasAttachment?: boolean;
  attachmentUrl?: string | null;
  isPpv?: boolean;
  ppvPrice?: Prisma.Decimal | number | null;
  isPurchased?: boolean;
  [key: string]: any;
};

/**
 * Shape a message for a given viewer: a PPV message stays locked (no text,
 * no attachment) for its recipient until it is purchased.
 */
export function presentMessage<T extends MessageLike>(message: T, viewerId?: string) {
  const isPpv = !!message.isPpv;
  const locked = isPpv && !message.isPurchased && viewerId === message.receiverId;
  return {
    ...message,
    isPpv,
    ppvPrice: message.ppvPrice != null ? Number(message.ppvPrice) : null,
    isPurchased: !!message.isPurchased,
    locked,
    content: locked ? '' : message.content,
    attachmentUrl: locked ? null : message.attachmentUrl ?? null,
    hasAttachment: !!message.hasAttachment,
  };
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private prisma: PrismaService,
    private paymentFlow: PaymentFlowService,
  ) {}

  /**
   * Whether `senderId` may send a direct message to `recipientId`.
   * A creator who disabled messages (CreatorProfile.allowMessages = false) can
   * only be messaged back by people they already wrote to; admins are exempt.
   */
  async canMessage(senderId: string, recipientId: string, recipient?: RecipientInfo): Promise<boolean> {
    const target =
      recipient !== undefined
        ? recipient
        : await this.prisma.user.findUnique({
            where: { id: recipientId },
            select: { role: true, creatorProfile: { select: { allowMessages: true } } },
          });

    if (!target || target.role !== 'CREATOR' || target.creatorProfile?.allowMessages !== false) {
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
      include: { lastMessage: { select: LAST_MESSAGE_SELECT } },
    });

    const canMessage = await this.canMessage(userId, partner.id);

    if (!conversation) {
      if (!canMessage) {
        throw new ForbiddenException("Ce créateur n'accepte pas les messages");
      }
      try {
        conversation = await this.prisma.conversation.create({
          data: { participant1Id: userId, participant2Id: partner.id },
          include: { lastMessage: { select: LAST_MESSAGE_SELECT } },
        });
      } catch (error: any) {
        // Created concurrently (unique pair): reuse it
        if (error?.code !== 'P2002') {
          throw error;
        }
        conversation = await this.prisma.conversation.findFirst({
          where: { participant1Id: userId, participant2Id: partner.id },
          include: { lastMessage: { select: LAST_MESSAGE_SELECT } },
        });
      }
    }

    const { id, username, displayName, avatar } = partner;
    const unreadCount = await this.prisma.message.count({
      where: { senderId: partner.id, receiverId: userId, deletedAt: null, status: { not: 'READ' } },
    });

    return {
      id: conversation!.id,
      participant: { id, username, displayName, avatar },
      lastMessage: this.presentLastMessage(conversation!.lastMessage, userId),
      updatedAt: conversation!.updatedAt,
      unreadCount,
      canMessage,
    };
  }

  async getConversations(userId: string) {
    const participantSelect = {
      ...PARTICIPANT_SELECT,
      role: true,
      creatorProfile: { select: { allowMessages: true } },
    } as const;

    const [conversations, unread] = await Promise.all([
      this.prisma.conversation.findMany({
        where: {
          OR: [{ participant1Id: userId }, { participant2Id: userId }],
        },
        include: {
          participant1: { select: participantSelect },
          participant2: { select: participantSelect },
          lastMessage: { select: LAST_MESSAGE_SELECT },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      }),
      this.prisma.message.groupBy({
        by: ['senderId'],
        where: { receiverId: userId, deletedAt: null, status: { not: 'READ' } },
        _count: { _all: true },
      }),
    ]);

    const unreadBySender = new Map<string, number>(
      (unread as any[]).map((row) => [row.senderId, row._count?._all ?? 0]),
    );

    // Transform to include the "other" participant
    return Promise.all(
      conversations.map(async (conv: any) => {
        const other = conv.participant1Id === userId ? conv.participant2 : conv.participant1;
        const { role, creatorProfile, ...participant } = other;

        return {
          id: conv.id,
          participant,
          lastMessage: this.presentLastMessage(conv.lastMessage, userId),
          updatedAt: conv.updatedAt,
          unreadCount: unreadBySender.get(other.id) ?? 0,
          canMessage: await this.canMessage(userId, other.id, { role, creatorProfile }),
        };
      }),
    );
  }

  /**
   * Messages of a conversation, newest page first (returned oldest first).
   * `before` (ISO date) loads the messages older than the oldest one displayed.
   */
  async getMessages(userId: string, partnerId: string, page = 1, limit = 50, before?: string) {
    const take = Math.min(Math.max(limit || 50, 1), 100);
    const beforeDate = before ? new Date(before) : null;
    if (beforeDate && Number.isNaN(beforeDate.getTime())) {
      throw new BadRequestException('Invalid "before" date');
    }

    const conversationWhere: Prisma.MessageWhereInput = {
      deletedAt: null,
      OR: [
        { senderId: userId, receiverId: partnerId },
        { senderId: partnerId, receiverId: userId },
      ],
    };
    const where: Prisma.MessageWhereInput = beforeDate
      ? { ...conversationWhere, createdAt: { lt: beforeDate } }
      : conversationWhere;

    const [messages, total, remaining] = await Promise.all([
      this.prisma.message.findMany({
        where,
        select: MESSAGE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: beforeDate ? 0 : (Math.max(page, 1) - 1) * take,
        take,
      }),
      this.prisma.message.count({ where: conversationWhere }),
      this.prisma.message.count({ where }),
    ]);

    const skipped = beforeDate ? 0 : (Math.max(page, 1) - 1) * take;

    return {
      items: messages.reverse().map((message: any) => presentMessage(message, userId)), // Oldest first
      total,
      page,
      totalPages: Math.ceil(total / take),
      hasMore: skipped + messages.length < remaining,
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
    options: { ppvPrice?: number } = {},
  ) {
    if (senderId === receiverId) {
      throw new BadRequestException('You cannot message yourself');
    }

    const text = (content ?? '').trim();
    if (!text && !attachmentUrl) {
      throw new BadRequestException('Le message est vide');
    }
    if (text.length > MESSAGE_MAX_LENGTH) {
      throw new BadRequestException(`Le message ne peut pas dépasser ${MESSAGE_MAX_LENGTH} caractères`);
    }

    const recipient = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: {
        role: true,
        status: true,
        deletedAt: true,
        creatorProfile: { select: { allowMessages: true } },
      },
    });
    if (!recipient || recipient.deletedAt || recipient.status === 'BANNED') {
      throw new NotFoundException('Destinataire introuvable');
    }
    if (!(await this.canMessage(senderId, receiverId, recipient))) {
      throw new ForbiddenException("Ce créateur n'accepte pas les messages");
    }

    let ppvPrice: number | null = null;
    if (options.ppvPrice != null) {
      ppvPrice = roundMoney(Number(options.ppvPrice));
      if (!(ppvPrice >= MESSAGE_PPV_MIN_PRICE && ppvPrice <= MESSAGE_PPV_MAX_PRICE)) {
        throw new BadRequestException(
          `Le prix doit être compris entre ${MESSAGE_PPV_MIN_PRICE} € et ${MESSAGE_PPV_MAX_PRICE} €`,
        );
      }
      const sender = await this.prisma.user.findUnique({
        where: { id: senderId },
        select: { role: true },
      });
      if (sender?.role !== 'CREATOR') {
        throw new ForbiddenException('Seuls les créateurs peuvent envoyer des messages payants');
      }
    }

    const message = await this.prisma.message.create({
      data: {
        senderId,
        receiverId,
        content: text,
        status: 'SENT',
        hasAttachment: !!attachmentUrl,
        attachmentUrl: attachmentUrl || null,
        ...(ppvPrice != null && { isPpv: true, ppvPrice }),
      },
      include: {
        sender: { select: PARTICIPANT_SELECT },
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

  /**
   * Mark every message received from `partnerId` as read.
   * Returns the ids that changed, so the sender can be notified.
   */
  async markConversationRead(userId: string, partnerId: string) {
    const unread = await this.prisma.message.findMany({
      where: { senderId: partnerId, receiverId: userId, deletedAt: null, status: { not: 'READ' } },
      select: { id: true },
    });
    const messageIds = unread.map((m) => m.id);

    if (messageIds.length > 0) {
      await this.prisma.message.updateMany({
        where: { id: { in: messageIds } },
        data: { status: 'READ', readAt: new Date() },
      });
    }

    return { messageIds, count: messageIds.length };
  }

  /**
   * Delete one of your own messages (soft delete, kept for moderation)
   */
  async deleteMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        senderId: userId,
        deletedAt: null,
      },
    });

    if (!message) {
      throw new NotFoundException('Message introuvable');
    }
    if (message.isPpv && message.isPurchased) {
      throw new BadRequestException('Un message payant déjà acheté ne peut pas être supprimé');
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    // Keep the conversation preview on the latest remaining message
    const conversation = await this.prisma.conversation.findFirst({
      where: { lastMessageId: messageId },
      select: { id: true },
    });
    if (conversation) {
      const previous = await this.prisma.message.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { senderId: message.senderId, receiverId: message.receiverId },
            { senderId: message.receiverId, receiverId: message.senderId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageId: previous?.id ?? null },
      });
    }

    return { success: true, messageId, receiverId: message.receiverId };
  }

  /**
   * Start the purchase of a PPV message (recipient only): completes right away
   * with a saved card, or returns the provider's payment page to redirect to
   */
  async unlockMessage(userId: string, messageId: string, options: PurchaseOptions = {}) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { sender: { select: { id: true, username: true } } },
    });

    if (!message || message.deletedAt || message.receiverId !== userId) {
      throw new NotFoundException('Message introuvable');
    }
    if (!message.isPpv || !message.ppvPrice || Number(message.ppvPrice) <= 0) {
      throw new BadRequestException("Ce message n'est pas payant");
    }
    if (message.isPurchased) {
      return { unlocked: true, alreadyUnlocked: true, messageId };
    }

    const payment = await this.paymentFlow.startPayment({
      ...options,
      payerId: userId,
      creatorId: message.senderId,
      kind: 'message_unlock',
      amount: Number(message.ppvPrice),
      description: `Message privé de @${message.sender.username}`,
      metadata: { messageId },
      returnPath: `/messages?user=${message.sender.username}`,
    });

    this.logger.log(`PPV message unlock started: ${messageId} by user ${userId} (${payment.status})`);

    return {
      ...payment,
      unlocked: payment.completed,
      alreadyUnlocked: false,
      messageId,
    };
  }

  /**
   * State of a PPV message payment (after the provider's payment page, idempotent)
   */
  async confirmUnlockMessage(userId: string, messageId: string, transactionId: string) {
    const payment = await this.paymentFlow.confirmPayment(userId, transactionId, {
      kind: 'message_unlock',
      metadata: { messageId },
    });

    return {
      ...payment,
      unlocked: payment.completed,
      messageId,
    };
  }

  /**
   * People the user can start a conversation with.
   * Without a query: the creators a fan follows / is subscribed to, or a
   * creator's subscribers and followers. With a query, fans search creators,
   * creators also search their own audience, staff search everyone.
   */
  async searchContacts(userId: string, query?: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!me) {
      throw new NotFoundException('User not found');
    }

    const q = (query ?? '').trim().replace(/^@/, '');
    const audience: Prisma.UserWhereInput[] = [
      { subscriptions: { some: { status: 'ACTIVE', tier: { creatorId: userId } } } },
      { following: { some: { creatorId: userId } } },
    ];
    const followedCreators: Prisma.UserWhereInput[] = [
      { role: 'CREATOR', followers: { some: { followerId: userId } } },
      {
        role: 'CREATOR',
        subscriptionTiers: { some: { subscriptions: { some: { subscriberId: userId, status: 'ACTIVE' } } } },
      },
    ];
    const isStaff = me.role === 'ADMIN' || me.role === 'MODERATOR';

    let scope: Prisma.UserWhereInput;
    if (!q) {
      if (isStaff) return [];
      scope = { OR: me.role === 'CREATOR' ? [...audience, ...followedCreators] : followedCreators };
    } else {
      const textMatch: Prisma.UserWhereInput = {
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      };
      const allowed: Prisma.UserWhereInput | null = isStaff
        ? null
        : me.role === 'CREATOR'
          ? { OR: [{ role: 'CREATOR' }, ...audience] }
          : { role: 'CREATOR' };
      scope = allowed ? { AND: [textMatch, allowed] } : textMatch;
    }

    const users = await this.prisma.user.findMany({
      where: {
        AND: [{ id: { not: userId }, deletedAt: null, status: 'ACTIVE' }, scope],
      },
      select: {
        ...PARTICIPANT_SELECT,
        role: true,
        creatorProfile: { select: { allowMessages: true } },
      },
      orderBy: { username: 'asc' },
      take: 20,
    });

    return Promise.all(
      users.map(async ({ role, creatorProfile, ...user }: any) => ({
        ...user,
        role,
        canMessage: await this.canMessage(userId, user.id, { role, creatorProfile }),
      })),
    );
  }

  /**
   * Conversation preview: hide deleted messages and the text of locked PPV ones
   */
  private presentLastMessage(lastMessage: any, viewerId: string) {
    if (!lastMessage || lastMessage.deletedAt) {
      return null;
    }
    const rest = { ...lastMessage };
    delete rest.deletedAt;
    const locked = !!rest.isPpv && !rest.isPurchased && rest.receiverId === viewerId;
    return { ...rest, locked, content: locked ? '' : rest.content };
  }
}
