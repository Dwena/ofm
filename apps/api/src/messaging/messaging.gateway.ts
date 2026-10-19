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
import { Logger, UseGuards } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MessagingService } from './messaging.service';

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
  private userSockets = new Map<string, string>(); // userId -> socketId

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private messagingService: MessagingService,
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
      this.userSockets.set(payload.sub, client.id);

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
    },
  ) {
    try {
      const { recipientId, content, type = 'TEXT', attachmentUrl } = data;

      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      // Create message and update conversation
      const message = await this.messagingService.sendMessage(
        client.userId,
        recipientId,
        content,
        attachmentUrl,
      );

      // Prepare message data to emit
      const messageData = this.toMessagePayload(message);

      // Emit to recipient if online
      this.emitNewMessage(recipientId, messageData);

      // Emit to sender for confirmation
      client.emit('message:sent', {
        message: messageData,
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

  // Shape a persisted message for socket clients
  toMessagePayload(message: any) {
    return {
      id: message.id,
      content: message.content,
      senderId: message.senderId,
      receiverId: message.receiverId,
      createdAt: message.createdAt,
      hasAttachment: message.hasAttachment,
      attachmentUrl: message.attachmentUrl,
      sender: message.sender,
    };
  }

  // Push a new message to the recipient's room (no-op if offline)
  emitNewMessage(recipientId: string, message: any) {
    this.server?.to(`user:${recipientId}`).emit('message:new', { message });
  }

  // Utility method to send notification to user
  sendNotificationToUser(userId: string, notification: any) {
    this.server.to(`user:${userId}`).emit('notification:new', notification);
  }

  // Check if user is online
  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId);
  }
}
