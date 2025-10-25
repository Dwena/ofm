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
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

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
    @MessageBody() data: { recipientId: string; content: string; type?: string },
  ) {
    try {
      const { recipientId, content, type = 'TEXT' } = data;

      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      // Create message in database
      const message = await this.prisma.message.create({
        data: {
          senderId: client.userId,
          recipientId,
          content,
          type: type as any,
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
      });

      // Update or create conversation
      await this.updateConversation(client.userId, recipientId, message.id);

      // Emit to recipient if online
      this.server.to(`user:${recipientId}`).emit('message:new', {
        message: {
          id: message.id,
          content: message.content,
          type: message.type,
          senderId: message.senderId,
          recipientId: message.recipientId,
          createdAt: message.createdAt,
          sender: message.sender,
        },
      });

      // Emit to sender for confirmation
      client.emit('message:sent', {
        message: {
          id: message.id,
          content: message.content,
          type: message.type,
          senderId: message.senderId,
          recipientId: message.recipientId,
          createdAt: message.createdAt,
        },
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
          recipientId: client.userId,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      // Get sender IDs to notify
      const messages = await this.prisma.message.findMany({
        where: { id: { in: data.messageIds } },
        select: { senderId: true },
      });

      const senderIds = [...new Set(messages.map(m => m.senderId))];

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
      // Update existing conversation
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageId,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new conversation
      await this.prisma.conversation.create({
        data: {
          participant1Id: userId1,
          participant2Id: userId2,
          lastMessageId,
        },
      });
    }
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
