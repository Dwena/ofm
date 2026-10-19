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
import { Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/database/prisma.service';
import { StreamingService } from './streaming.service';
import { OneTimePaymentService, TipCompletedEvent } from '../payments/one-time-payment.service';

interface SocketUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
}

export interface AuthenticatedStreamSocket extends Socket {
  userId?: string;
  user?: SocketUser;
}

interface StreamRoomState {
  creatorId: string;
  broadcasterSocketId?: string;
  // socketId -> userId of every viewer socket in the room
  viewers: Map<string, string>;
}

export interface LiveChatMessage {
  id: string;
  userId: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  message: string;
  timestamp: string;
  type: 'MESSAGE' | 'TIP' | 'SYSTEM';
  isCreator: boolean;
  /** Euros, for TIP messages */
  tipAmount?: number;
}

type Ack = { success: true; [key: string]: unknown } | { error: string; reason?: string };

export const CHAT_RATE_LIMIT_MS = 500;
export const REACTION_RATE_LIMIT_MS = 200;
export const ALLOWED_REACTIONS = ['❤️', '🔥', '👏', '😍', '🎉', '💎'];

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const clampPercent = (value: unknown, fallback: number) => {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, num));
};

export const streamRoom = (streamId: string) => `stream:${streamId}`;

/**
 * Live streaming gateway.
 *
 * Signaling model: one-to-many mesh where the creator (broadcaster) is the
 * WebRTC offerer for every viewer. A viewer asks for an offer with
 * `request-offer`; the broadcaster receives `viewer-joined` with the viewer's
 * socket id, sends `offer` back, and the viewer replies with `answer`.
 * ICE candidates are relayed in both directions with `ice-candidate`. An
 * optional `sessionId` chosen by the broadcaster is relayed with each of them.
 *
 * Room state is kept in memory, so the API must run as a single instance (or
 * with sticky sessions and a socket.io adapter) for live streaming.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/streaming',
})
export class StreamingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger('StreamingGateway');
  private rooms = new Map<string, StreamRoomState>();
  private socketStreams = new Map<string, Set<string>>(); // socketId -> streamIds
  private lastChatAt = new Map<string, number>();
  private lastReactionAt = new Map<string, number>();
  private tipSubscription?: Subscription;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private streamingService: StreamingService,
    @Optional() private oneTimePayments?: OneTimePaymentService,
  ) {}

  onModuleInit() {
    // Paid tips sent from a live are announced in its chat
    this.tipSubscription = this.oneTimePayments?.tipCompleted$.subscribe((tip) => this.notifyTip(tip));
  }

  onModuleDestroy() {
    this.tipSubscription?.unsubscribe();
  }

  async handleConnection(client: AuthenticatedStreamSocket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn('Client connection rejected - no token');
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, username: true, displayName: true, avatar: true, status: true },
      });

      if (!user || user.status === 'BANNED' || user.status === 'SUSPENDED') {
        this.logger.warn(`Client connection rejected - user ${payload.sub} not allowed`);
        client.disconnect();
        return;
      }

      client.userId = user.id;
      client.user = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
      };

      this.logger.log(`Client connected: ${client.id} (User: ${user.id})`);
    } catch (error) {
      this.logger.error('Connection error:', error.message);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedStreamSocket) {
    const streamIds = [...(this.socketStreams.get(client.id) ?? [])];
    for (const streamId of streamIds) {
      await this.removeSocketFromStream(client, streamId);
    }
    this.socketStreams.delete(client.id);
    this.lastChatAt.delete(client.id);
    this.lastReactionAt.delete(client.id);
  }

  /**
   * Viewer joins a live stream room (access rules are enforced here)
   */
  @SubscribeMessage('join-live-stream')
  async handleJoinStream(
    @ConnectedSocket() client: AuthenticatedStreamSocket,
    @MessageBody() data: { streamId: string },
  ): Promise<Ack> {
    if (!client.userId) return { error: 'Unauthorized' };
    if (!isNonEmptyString(data?.streamId)) return { error: 'Invalid stream' };

    const { streamId } = data;

    try {
      const stream = await this.streamingService.getStreamForRealtime(streamId);
      if (!stream) return { error: 'Stream not found', reason: 'NOT_FOUND' };
      if (stream.status !== 'LIVE') return { error: 'Stream is not live', reason: 'NOT_LIVE' };

      const access = await this.streamingService.checkViewAccess(client.userId, stream);
      if (!access.allowed) return { error: 'Forbidden', reason: access.reason };

      const room = this.getOrCreateRoom(streamId, stream.creatorId);
      const alreadyWatching = this.isUserWatching(room, client.userId);

      room.viewers.set(client.id, client.userId);
      this.trackSocketStream(client.id, streamId);
      await client.join(streamRoom(streamId));

      if (!access.isCreator && !alreadyWatching) {
        await this.streamingService.registerViewer(streamId, client.userId);
      }

      const viewerCount = await this.broadcastViewerCount(streamId);
      const messages = await this.streamingService.getRecentChatMessages(streamId);

      return {
        success: true,
        viewerCount,
        broadcasterOnline: !!room.broadcasterSocketId,
        messages: messages.map((message) => this.toChatMessage(message, stream.creatorId)),
      };
    } catch (error) {
      this.logger.error('Join stream error:', error);
      return { error: 'Unable to join stream' };
    }
  }

  @SubscribeMessage('leave-live-stream')
  async handleLeaveStream(
    @ConnectedSocket() client: AuthenticatedStreamSocket,
    @MessageBody() data: { streamId: string },
  ): Promise<Ack> {
    if (!client.userId) return { error: 'Unauthorized' };
    if (!isNonEmptyString(data?.streamId)) return { error: 'Invalid stream' };

    await this.removeSocketFromStream(client, data.streamId);
    return { success: true };
  }

  /**
   * Creator starts broadcasting from this socket (stream must already be LIVE)
   */
  @SubscribeMessage('start-broadcast')
  async handleStartBroadcast(
    @ConnectedSocket() client: AuthenticatedStreamSocket,
    @MessageBody() data: { streamId: string },
  ): Promise<Ack> {
    if (!client.userId) return { error: 'Unauthorized' };
    if (!isNonEmptyString(data?.streamId)) return { error: 'Invalid stream' };

    const { streamId } = data;

    try {
      const stream = await this.streamingService.getStreamForRealtime(streamId);
      if (!stream) return { error: 'Stream not found', reason: 'NOT_FOUND' };
      if (stream.creatorId !== client.userId) {
        return { error: 'Only the creator can broadcast this stream', reason: 'NOT_CREATOR' };
      }
      if (stream.status !== 'LIVE') return { error: 'Stream is not live', reason: 'NOT_LIVE' };

      const room = this.getOrCreateRoom(streamId, stream.creatorId);
      const previous = room.broadcasterSocketId;
      if (previous && previous !== client.id) {
        this.server.to(previous).emit('broadcast-replaced', { streamId });
      }

      room.broadcasterSocketId = client.id;
      // A broadcaster socket is never counted as a viewer
      room.viewers.delete(client.id);
      this.trackSocketStream(client.id, streamId);
      await client.join(streamRoom(streamId));

      // Viewers already waiting reconnect by requesting a fresh offer
      client.to(streamRoom(streamId)).emit('broadcaster-ready', { streamId });

      const viewerCount = this.countViewers(room);
      const messages = await this.streamingService.getRecentChatMessages(streamId);

      return {
        success: true,
        viewerCount,
        messages: messages.map((message) => this.toChatMessage(message, stream.creatorId)),
      };
    } catch (error) {
      this.logger.error('Start broadcast error:', error);
      return { error: 'Unable to start broadcast' };
    }
  }

  /**
   * Viewer asks the broadcaster for a WebRTC offer
   */
  @SubscribeMessage('request-offer')
  handleRequestOffer(
    @ConnectedSocket() client: AuthenticatedStreamSocket,
    @MessageBody() data: { streamId: string },
  ): Ack {
    const room = this.getViewerRoom(client, data?.streamId);
    if (!room) return { error: 'Not watching this stream' };
    if (!room.broadcasterSocketId) return { error: 'Broadcaster offline', reason: 'BROADCASTER_OFFLINE' };

    this.server.to(room.broadcasterSocketId).emit('viewer-joined', {
      streamId: data.streamId,
      viewerId: client.id,
      userId: client.userId,
    });
    return { success: true };
  }

  /**
   * Broadcaster sends an offer to one viewer
   */
  @SubscribeMessage('offer')
  handleOffer(
    @ConnectedSocket() client: AuthenticatedStreamSocket,
    @MessageBody() data: { streamId: string; viewerId: string; offer: unknown; sessionId?: string },
  ): Ack {
    const room = this.getBroadcasterRoom(client, data?.streamId);
    if (!room) return { error: 'Not broadcasting this stream' };
    if (!isNonEmptyString(data.viewerId) || !room.viewers.has(data.viewerId)) {
      return { error: 'Unknown viewer' };
    }
    if (!data.offer) return { error: 'Invalid offer' };

    this.server.to(data.viewerId).emit('offer', {
      streamId: data.streamId,
      offer: data.offer,
      sessionId: this.sessionIdOf(data),
    });
    return { success: true };
  }

  /**
   * Viewer answers the broadcaster's offer
   */
  @SubscribeMessage('answer')
  handleAnswer(
    @ConnectedSocket() client: AuthenticatedStreamSocket,
    @MessageBody() data: { streamId: string; answer: unknown; sessionId?: string },
  ): Ack {
    const room = this.getViewerRoom(client, data?.streamId);
    if (!room) return { error: 'Not watching this stream' };
    if (!room.broadcasterSocketId) return { error: 'Broadcaster offline', reason: 'BROADCASTER_OFFLINE' };
    if (!data.answer) return { error: 'Invalid answer' };

    this.server.to(room.broadcasterSocketId).emit('answer', {
      streamId: data.streamId,
      viewerId: client.id,
      answer: data.answer,
      sessionId: this.sessionIdOf(data),
    });
    return { success: true };
  }

  /**
   * ICE candidates, relayed broadcaster -> viewer (viewerId required) or viewer -> broadcaster
   */
  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    @ConnectedSocket() client: AuthenticatedStreamSocket,
    @MessageBody() data: { streamId: string; candidate: unknown; viewerId?: string; sessionId?: string },
  ): Ack {
    if (!client.userId || !isNonEmptyString(data?.streamId) || !data.candidate) {
      return { error: 'Invalid candidate' };
    }

    const room = this.rooms.get(data.streamId);
    if (!room) return { error: 'Stream not active' };

    if (room.broadcasterSocketId === client.id) {
      if (!isNonEmptyString(data.viewerId) || !room.viewers.has(data.viewerId)) {
        return { error: 'Unknown viewer' };
      }
      this.server.to(data.viewerId).emit('ice-candidate', {
        streamId: data.streamId,
        candidate: data.candidate,
        sessionId: this.sessionIdOf(data),
      });
      return { success: true };
    }

    if (!room.viewers.has(client.id)) return { error: 'Not watching this stream' };
    if (!room.broadcasterSocketId) return { error: 'Broadcaster offline', reason: 'BROADCASTER_OFFLINE' };

    this.server.to(room.broadcasterSocketId).emit('ice-candidate', {
      streamId: data.streamId,
      viewerId: client.id,
      candidate: data.candidate,
      sessionId: this.sessionIdOf(data),
    });
    return { success: true };
  }

  /**
   * Chat message from a viewer or the creator, persisted to StreamMessage
   */
  @SubscribeMessage('send-chat-message')
  async handleChatMessage(
    @ConnectedSocket() client: AuthenticatedStreamSocket,
    @MessageBody() data: { streamId: string; message: string },
  ): Promise<Ack> {
    const room = this.getMemberRoom(client, data?.streamId);
    if (!room) return { error: 'Not in this stream' };
    if (!isNonEmptyString(data.message)) return { error: 'Message cannot be empty' };

    const now = Date.now();
    if (now - (this.lastChatAt.get(client.id) ?? 0) < CHAT_RATE_LIMIT_MS) {
      return { error: 'Too many messages', reason: 'RATE_LIMITED' };
    }
    this.lastChatAt.set(client.id, now);

    try {
      const saved = await this.streamingService.createChatMessage(data.streamId, client.userId!, data.message);
      const chatMessage = this.toChatMessage(saved, room.creatorId);
      this.server.to(streamRoom(data.streamId)).emit('chat-message', chatMessage);
      return { success: true, messageId: saved.id };
    } catch (error) {
      this.logger.error('Chat message error:', error);
      return { error: error.message || 'Unable to send message' };
    }
  }

  /**
   * Emoji reaction, broadcast to the whole room (not persisted)
   */
  @SubscribeMessage('send-reaction')
  handleReaction(
    @ConnectedSocket() client: AuthenticatedStreamSocket,
    @MessageBody() data: { streamId: string; emoji: string; x?: number; y?: number },
  ): Ack {
    const room = this.getMemberRoom(client, data?.streamId);
    if (!room) return { error: 'Not in this stream' };
    if (!ALLOWED_REACTIONS.includes(data.emoji)) return { error: 'Invalid reaction' };

    const now = Date.now();
    if (now - (this.lastReactionAt.get(client.id) ?? 0) < REACTION_RATE_LIMIT_MS) {
      return { error: 'Too many reactions', reason: 'RATE_LIMITED' };
    }
    this.lastReactionAt.set(client.id, now);

    this.server.to(streamRoom(data.streamId)).emit('reaction', {
      emoji: data.emoji,
      x: clampPercent(data.x, 50),
      y: clampPercent(data.y, 80),
      userId: client.userId,
    });
    return { success: true };
  }

  /**
   * Called when a stream ends (REST end endpoint): notify everyone and drop the room
   */
  notifyStreamEnded(streamId: string) {
    if (!this.server) return;

    this.server.to(streamRoom(streamId)).emit('stream-ended', { streamId });
    this.server.in(streamRoom(streamId)).socketsLeave(streamRoom(streamId));

    const room = this.rooms.get(streamId);
    if (room) {
      const sockets = [...room.viewers.keys()];
      if (room.broadcasterSocketId) sockets.push(room.broadcasterSocketId);
      sockets.forEach((socketId) => this.socketStreams.get(socketId)?.delete(streamId));
    }
    this.rooms.delete(streamId);
  }

  /**
   * Announce a paid tip in the live chat (`chat-message` of type TIP, plus a
   * `tip` event for on-screen effects)
   */
  notifyTip(tip: TipCompletedEvent) {
    if (!this.server || !tip.streamId) return;

    const message: LiveChatMessage = {
      id: `tip-${tip.transactionId}`,
      userId: tip.fromUser.id,
      username: tip.fromUser.username,
      displayName: tip.fromUser.displayName,
      avatar: tip.fromUser.avatar,
      message: tip.message || `a envoyé un pourboire de ${tip.amount.toFixed(2)}€`,
      timestamp: tip.completedAt.toISOString(),
      type: 'TIP',
      isCreator: false,
      tipAmount: tip.amount,
    };

    const room = streamRoom(tip.streamId);
    this.server.to(room).emit('chat-message', message);
    this.server.to(room).emit('tip', {
      streamId: tip.streamId,
      transactionId: tip.transactionId,
      amount: tip.amount,
      message: tip.message,
      fromUser: tip.fromUser,
    });
  }

  getViewerCount(streamId: string) {
    const room = this.rooms.get(streamId);
    return room ? this.countViewers(room) : 0;
  }

  private async removeSocketFromStream(client: AuthenticatedStreamSocket, streamId: string) {
    const room = this.rooms.get(streamId);
    this.socketStreams.get(client.id)?.delete(streamId);
    client.leave(streamRoom(streamId));

    if (!room) return;

    if (room.broadcasterSocketId === client.id) {
      room.broadcasterSocketId = undefined;
      this.server.to(streamRoom(streamId)).emit('broadcaster-disconnected', { streamId });
      this.logger.log(`Broadcaster left stream ${streamId}`);
    }

    const userId = room.viewers.get(client.id);
    if (userId) {
      room.viewers.delete(client.id);

      if (room.broadcasterSocketId) {
        this.server.to(room.broadcasterSocketId).emit('viewer-left', { streamId, viewerId: client.id });
      }

      try {
        if (userId !== room.creatorId && !this.isUserWatching(room, userId)) {
          await this.streamingService.markViewerLeft(streamId, userId);
        }
        await this.broadcastViewerCount(streamId);
      } catch (error) {
        this.logger.error('Leave stream error:', error);
      }
    }

    if (!room.broadcasterSocketId && room.viewers.size === 0) {
      this.rooms.delete(streamId);
    }
  }

  private async broadcastViewerCount(streamId: string) {
    const room = this.rooms.get(streamId);
    const count = room ? this.countViewers(room) : 0;
    this.server.to(streamRoom(streamId)).emit('viewer-count', count);
    await this.streamingService.updateViewerStats(streamId, count);
    return count;
  }

  private countViewers(room: StreamRoomState) {
    const users = new Set<string>();
    room.viewers.forEach((userId) => {
      if (userId !== room.creatorId) users.add(userId);
    });
    return users.size;
  }

  private isUserWatching(room: StreamRoomState, userId: string) {
    for (const viewerUserId of room.viewers.values()) {
      if (viewerUserId === userId) return true;
    }
    return false;
  }

  /**
   * Opaque id the broadcaster attaches to each offer so both peers can drop
   * answers/candidates that belong to an older negotiation
   */
  private sessionIdOf(data: { sessionId?: unknown }) {
    return typeof data.sessionId === 'string' && data.sessionId.length <= 64 ? data.sessionId : undefined;
  }

  private getOrCreateRoom(streamId: string, creatorId: string) {
    let room = this.rooms.get(streamId);
    if (!room) {
      room = { creatorId, viewers: new Map() };
      this.rooms.set(streamId, room);
    }
    return room;
  }

  private trackSocketStream(socketId: string, streamId: string) {
    const streams = this.socketStreams.get(socketId) ?? new Set<string>();
    streams.add(streamId);
    this.socketStreams.set(socketId, streams);
  }

  private getViewerRoom(client: AuthenticatedStreamSocket, streamId: unknown) {
    if (!client.userId || !isNonEmptyString(streamId)) return undefined;
    const room = this.rooms.get(streamId);
    return room?.viewers.has(client.id) ? room : undefined;
  }

  private getBroadcasterRoom(client: AuthenticatedStreamSocket, streamId: unknown) {
    if (!client.userId || !isNonEmptyString(streamId)) return undefined;
    const room = this.rooms.get(streamId);
    return room?.broadcasterSocketId === client.id ? room : undefined;
  }

  private getMemberRoom(client: AuthenticatedStreamSocket, streamId: unknown) {
    return this.getViewerRoom(client, streamId) ?? this.getBroadcasterRoom(client, streamId);
  }

  private toChatMessage(
    message: {
      id: string;
      senderId: string;
      message: string;
      createdAt: Date;
      sender?: { username: string; displayName?: string | null; avatar?: string | null } | null;
    },
    creatorId: string,
  ): LiveChatMessage {
    return {
      id: message.id,
      userId: message.senderId,
      username: message.sender?.username ?? 'utilisateur',
      displayName: message.sender?.displayName ?? null,
      avatar: message.sender?.avatar ?? null,
      message: message.message,
      timestamp: message.createdAt.toISOString(),
      type: 'MESSAGE',
      isCreator: message.senderId === creatorId,
    };
  }
}
