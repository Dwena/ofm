import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MessagingService, presentMessage } from './messaging.service';
import { AgeVerificationService } from '../age-verification/age-verification.service';
import { gateMessage } from '../age-verification/age-gate';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/messaging',
})
export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('MessagingGateway');
  private userSockets = new Map<string, Set<string>>(); // userId -> socket ids (one per tab)

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private messagingService: MessagingService,
    @Optional() private ageVerification?: AgeVerificationService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Extract token from handshake
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn('Client connection rejected - no token');
        client.disconnect();
        return;
      }

      // Verify token
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      client.userId = payload.sub;
      const sockets = this.userSockets.get(payload.sub) ?? new Set<string>();
      sockets.add(client.id);
      this.userSockets.set(payload.sub, sockets);

      // Join user's personal room
      client.join(`user:${payload.sub}`);

      this.logger.log(`Client connected: ${client.id} (User: ${payload.sub})`);

      // Emit online status
      this.server.emit('user:online', { userId: payload.sub });
    } catch (error) {
      this.logger.error('Connection error:', error.message);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      const sockets = this.userSockets.get(client.userId);
      sockets?.delete(client.id);
      if (sockets && sockets.size > 0) {
        // Still connected from another tab
        return;
      }
      this.userSockets.delete(client.userId);
      this.server.emit('user:offline', { userId: client.userId });
      this.logger.log(`Client disconnected: ${client.id} (User: ${client.userId})`);
    }
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: {
      recipientId: string;
      content: string;
      type?: string;
      attachmentUrl?: string;
      ppvPrice?: number;
    },
  ) {
    try {
      const { recipientId, content, attachmentUrl, ppvPrice } = data ?? ({} as typeof data);

      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      // Create message and update conversation
      const message = await this.messagingService.sendMessage(
        client.userId,
        recipientId,
        content,
        attachmentUrl,
        { ppvPrice },
      );

      // Emit to recipient if online (PPV stays locked for them)
      this.emitNewMessage(recipientId, this.toMessagePayload(message, recipientId));

      // Emit to the sender's tabs for confirmation
      this.emitToUser(client.userId, 'message:sent', {
        message: this.toMessagePayload(message, client.userId),
      });

      return { success: true, messageId: message.id };
    } catch (error) {
      this.logger.error('Send message error:', error);
      return { error: error.message };
    }
  }

  @SubscribeMessage('message:typing')
  async handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { recipientId: string; isTyping: boolean },
  ) {
    if (!client.userId) return;

    // Emit typing status to recipient
    this.server.to(`user:${data.recipientId}`).emit('message:typing', {
      userId: client.userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('message:read')
  async handleMarkAsRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageIds: string[] },
  ) {
    try {
      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      // Mark messages as read
      await this.prisma.message.updateMany({
        where: {
          id: { in: data.messageIds },
          receiverId: client.userId,
        },
        data: {
          status: 'READ' as any,
          readAt: new Date(),
        },
      });

      // Get sender IDs to notify
      const messages = await this.prisma.message.findMany({
        where: { id: { in: data.messageIds } },
        select: { senderId: true },
      });

      const senderIds = [...new Set(messages.map((m: any) => m.senderId))];

      // Notify senders
      senderIds.forEach(senderId => {
        this.server.to(`user:${senderId}`).emit('message:read', {
          messageIds: data.messageIds,
          readBy: client.userId,
        });
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Mark as read error:', error);
      return { error: error.message };
    }
  }

  /**
   * Which of the given users are connected (presence of conversation partners)
   */
  @SubscribeMessage('presence:query')
  handlePresenceQuery(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { userIds?: string[] },
  ) {
    if (!client.userId) {
      return { error: 'Unauthorized' };
    }
    const userIds = Array.isArray(data?.userIds) ? data.userIds.slice(0, 200) : [];
    return { online: userIds.filter((id) => this.isUserOnline(id)) };
  }

  // Shape a persisted message for socket clients, as seen by `viewerId`
  toMessagePayload(message: any, viewerId?: string) {
    const presented = presentMessage(message, viewerId ?? message.receiverId);
    return {
      id: presented.id,
      content: presented.content,
      senderId: presented.senderId,
      receiverId: presented.receiverId,
      createdAt: presented.createdAt,
      status: presented.status,
      hasAttachment: presented.hasAttachment,
      attachmentUrl: presented.attachmentUrl,
      isPpv: presented.isPpv,
      ppvPrice: presented.ppvPrice,
      isPurchased: presented.isPurchased,
      locked: presented.locked,
      sender: presented.sender,
    };
  }

  // Emit an event to every tab of a user
  emitToUser(userId: string, event: string, payload: any) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  // Push a new message to the recipient's room (no-op if offline)
  emitNewMessage(recipientId: string, message: any) {
    if (!message?.attachmentUrl || message.senderId === recipientId) {
      this.server?.to(`user:${recipientId}`).emit('message:new', { message });
      return;
    }
    // Attachments need a verified age (account check only: the web reloads
    // the conversation with its X-Age-Verification token when flagged)
    void (this.ageVerification?.isAgeVerifiedFor({ userId: recipientId }) ?? Promise.resolve(false))
      .catch(() => false)
      .then((ageVerified) => {
        this.server?.to(`user:${recipientId}`).emit('message:new', {
          message: gateMessage(message, { viewerId: recipientId, ageVerified }),
        });
      });
  }

  // Utility method to send notification to user
  sendNotificationToUser(userId: string, notification: any) {
    this.server?.to(`user:${userId}`).emit('notification:new', notification);
  }

  // Check if user is online
  isUserOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }
}
