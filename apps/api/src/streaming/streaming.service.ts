import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { CreateStreamDto, UpdateStreamDto } from './dto/create-stream.dto';
import { nanoid } from 'nanoid';
import { OneTimePaymentService } from '../payments/one-time-payment.service';

export type StreamAccessDeniedReason =
  | 'PRIVATE'
  | 'SUBSCRIPTION_REQUIRED'
  | 'PREMIUM_SUBSCRIPTION_REQUIRED'
  | 'PPV_PURCHASE_REQUIRED';

export interface StreamAccessResult {
  allowed: boolean;
  isCreator: boolean;
  reason?: StreamAccessDeniedReason;
}

export interface StreamAccessTarget {
  id: string;
  creatorId: string;
  visibility: string;
  isPpv: boolean;
}

export const MAX_CHAT_MESSAGE_LENGTH = 500;

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private oneTimePayments: OneTimePaymentService,
  ) {}

  /**
   * Create a new live stream
   */
  async createStream(userId: string, dto: CreateStreamDto) {
    // Verify user is a creator
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, stripeAccountId: true, stripeOnboarded: true },
    });

    if (user?.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can create live streams');
    }

    // If PPV, verify payment setup
    if (dto.isPpv) {
      if (!dto.ppvPrice || dto.ppvPrice <= 0) {
        throw new BadRequestException('PPV streams must have a valid price');
      }

      if (!user.stripeAccountId || !user.stripeOnboarded) {
        throw new BadRequestException('Payment account must be set up for PPV streams');
      }
    }

    // Generate unique stream key
    const streamKey = `stream_${nanoid(32)}`;

    // Create stream URL (this would be from your streaming service)
    // For now, placeholder - integrate with Agora, Twilio, or custom WebRTC server
    const streamUrl = `${this.configService.get('STREAM_BASE_URL', 'rtmp://localhost:1935/live')}/${streamKey}`;

    const stream = await this.prisma.liveStream.create({
      data: {
        creatorId: userId,
        title: dto.title,
        description: dto.description,
        thumbnailUrl: dto.thumbnailUrl,
        visibility: dto.visibility || 'SUBSCRIBERS_ONLY',
        isPpv: dto.isPpv || false,
        ppvPrice: dto.ppvPrice,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        streamKey,
        streamUrl,
        status: dto.scheduledFor ? 'SCHEDULED' : 'LIVE',
        startedAt: dto.scheduledFor ? null : new Date(),
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });

    this.logger.log(`Stream created: ${stream.id} by user ${userId}`);

    return {
      ...stream,
      // Don't expose stream key to non-creators
      streamKey: undefined,
      // Return stream key separately for creator
      creatorStreamKey: streamKey,
    };
  }

  /**
   * Update a stream
   */
  async updateStream(userId: string, streamId: string, dto: UpdateStreamDto) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { creatorId: true, status: true },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.creatorId !== userId) {
      throw new ForbiddenException('You can only update your own streams');
    }

    if (stream.status === 'ENDED') {
      throw new BadRequestException('Cannot update ended streams');
    }

    return this.prisma.liveStream.update({
      where: { id: streamId },
      data: {
        title: dto.title,
        description: dto.description,
        thumbnailUrl: dto.thumbnailUrl,
        visibility: dto.visibility,
        isPpv: dto.isPpv,
        ppvPrice: dto.ppvPrice,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
        updatedAt: new Date(),
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
    });
  }

  /**
   * Start a stream
   */
  async startStream(userId: string, streamId: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { creatorId: true, status: true },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.creatorId !== userId) {
      throw new ForbiddenException('You can only start your own streams');
    }

    if (stream.status === 'LIVE') {
      throw new BadRequestException('Stream is already live');
    }

    if (stream.status === 'ENDED') {
      throw new BadRequestException('Cannot restart ended streams');
    }

    return this.prisma.liveStream.update({
      where: { id: streamId },
      data: {
        status: 'LIVE',
        startedAt: new Date(),
      },
    });
  }

  /**
   * End a stream
   */
  async endStream(userId: string, streamId: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { creatorId: true, status: true, startedAt: true },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.creatorId !== userId) {
      throw new ForbiddenException('You can only end your own streams');
    }

    if (stream.status === 'ENDED') {
      throw new BadRequestException('Stream is already ended');
    }

    // Calculate duration
    const duration = stream.startedAt
      ? Math.floor((new Date().getTime() - stream.startedAt.getTime()) / 1000)
      : null;

    const ended = await this.prisma.liveStream.update({
      where: { id: streamId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        duration,
        viewerCount: 0,
      },
    });

    await this.closeViewerSessions(streamId);

    return ended;
  }

  /**
   * Visibility filter for public stream listings: PRIVATE streams are only
   * listed for their own creator
   */
  private listingVisibilityFilter(userId?: string): Prisma.LiveStreamWhereInput {
    return userId
      ? { OR: [{ visibility: { not: 'PRIVATE' } }, { creatorId: userId }] }
      : { visibility: { not: 'PRIVATE' } };
  }

  /**
   * Strips the stream key (an RTMP publishing secret) from listed streams
   */
  private toPublicListing<T extends { streamKey?: string | null }>(streams: T[]): Omit<T, 'streamKey'>[] {
    return streams.map((stream) => {
      const listed = { ...stream };
      delete listed.streamKey;
      return listed;
    });
  }

  /**
   * Get active live streams
   */
  async getLiveStreams(userId?: string) {
    const streams = await this.prisma.liveStream.findMany({
      where: {
        status: 'LIVE',
        ...this.listingVisibilityFilter(userId),
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            viewers: true,
          },
        },
      },
      orderBy: {
        viewerCount: 'desc',
      },
    });
    return this.toPublicListing(streams);
  }

  /**
   * Get scheduled streams
   */
  async getScheduledStreams(userId?: string) {
    const streams = await this.prisma.liveStream.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: {
          gte: new Date(),
        },
        ...this.listingVisibilityFilter(userId),
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        scheduledFor: 'asc',
      },
    });
    return this.toPublicListing(streams);
  }

  /**
   * Get creator's streams
   */
  async getCreatorStreams(creatorId: string) {
    return this.prisma.liveStream.findMany({
      where: {
        creatorId,
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            viewers: true,
            messages: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get a single stream
   */
  async getStreamById(streamId: string, userId?: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            viewers: true,
            messages: true,
          },
        },
      },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    const { streamKey, ...publicStream } = stream;
    const access: StreamAccessResult = userId
      ? await this.checkViewAccess(userId, stream)
      : { allowed: stream.visibility === 'PUBLIC' && !stream.isPpv, isCreator: false };

    return {
      ...publicStream,
      // The stream key is only useful to the creator
      streamKey: access.isCreator ? streamKey : undefined,
      hasAccess: access.allowed,
      accessDeniedReason: access.reason ?? null,
    };
  }

  /**
   * Join a stream (track viewer). Live viewer counts are maintained by the
   * streaming gateway from the connected sockets, see updateViewerStats().
   */
  async joinStream(userId: string, streamId: string) {
    const stream = await this.getStreamForRealtime(streamId);

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.status !== 'LIVE') {
      throw new BadRequestException('Stream is not live');
    }

    await this.assertCanView(userId, stream);

    if (stream.creatorId !== userId) {
      await this.registerViewer(streamId, userId);
      this.logger.log(`User ${userId} joined stream ${streamId}`);
    }

    return { message: 'Joined stream successfully' };
  }

  /**
   * Leave a stream
   */
  async leaveStream(userId: string, streamId: string) {
    const left = await this.markViewerLeft(streamId, userId);

    if (left) {
      this.logger.log(`User ${userId} left stream ${streamId}`);
    }

    return { message: 'Left stream successfully' };
  }

  /**
   * Load the fields needed for access control and signaling
   */
  async getStreamForRealtime(streamId: string) {
    return this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: {
        id: true,
        creatorId: true,
        visibility: true,
        isPpv: true,
        status: true,
      },
    });
  }

  /**
   * Decide whether a user may watch a stream, following the stream's
   * visibility (ContentVisibility) and PPV settings.
   *
   * - The creator, admins and moderators can always watch.
   * - PUBLIC: any authenticated user.
   * - SUBSCRIBERS_ONLY: active subscription to any of the creator's tiers.
   * - PREMIUM_SUBSCRIBERS: active subscription to a tier priced above the
   *   creator's cheapest active tier (any tier when all tiers cost the same).
   * - PRIVATE: creator only.
   * - PPV visibility or isPpv: a completed PPV_UNLOCK transaction whose
   *   contentId is the stream id.
   */
  async checkViewAccess(userId: string, stream: StreamAccessTarget): Promise<StreamAccessResult> {
    if (stream.creatorId === userId) {
      return { allowed: true, isCreator: true };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role === 'ADMIN' || user?.role === 'MODERATOR') {
      return { allowed: true, isCreator: false };
    }

    switch (stream.visibility) {
      case 'PUBLIC':
      case 'PPV':
        break;
      case 'SUBSCRIBERS_ONLY': {
        const subscriptions = await this.getActiveSubscriptions(userId, stream.creatorId);
        if (subscriptions.length === 0) {
          return { allowed: false, isCreator: false, reason: 'SUBSCRIPTION_REQUIRED' };
        }
        break;
      }
      case 'PREMIUM_SUBSCRIBERS': {
        const subscriptions = await this.getActiveSubscriptions(userId, stream.creatorId);
        if (subscriptions.length === 0) {
          return { allowed: false, isCreator: false, reason: 'PREMIUM_SUBSCRIPTION_REQUIRED' };
        }
        const tiers = await this.prisma.subscriptionTier.findMany({
          where: { creatorId: stream.creatorId, isActive: true },
          select: { price: true },
        });
        const prices = tiers.map((tier) => Number(tier.price));
        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
        const hasPremiumTier = prices.some((price) => price > minPrice);
        const isPremium = subscriptions.some(
          (subscription) => !hasPremiumTier || Number(subscription.tier.price) > minPrice,
        );
        if (!isPremium) {
          return { allowed: false, isCreator: false, reason: 'PREMIUM_SUBSCRIPTION_REQUIRED' };
        }
        break;
      }
      case 'PRIVATE':
      default:
        return { allowed: false, isCreator: false, reason: 'PRIVATE' };
    }

    if (stream.isPpv || stream.visibility === 'PPV') {
      const purchase = await this.prisma.transaction.findFirst({
        where: {
          fromUserId: userId,
          toUserId: stream.creatorId,
          type: 'PPV_UNLOCK',
          status: 'COMPLETED',
          contentId: stream.id,
        },
        select: { id: true },
      });
      if (!purchase) {
        return { allowed: false, isCreator: false, reason: 'PPV_PURCHASE_REQUIRED' };
      }
    }

    return { allowed: true, isCreator: false };
  }

  /**
   * Throw ForbiddenException when the user cannot watch the stream
   */
  async assertCanView(userId: string, stream: StreamAccessTarget) {
    const access = await this.checkViewAccess(userId, stream);
    if (!access.allowed) {
      throw new ForbiddenException(access.reason ?? 'Access denied');
    }
    return access;
  }

  /**
   * Record (or re-open) a viewer session. Counts a view the first time a user joins.
   */
  async registerViewer(streamId: string, viewerId: string) {
    const existing = await this.prisma.streamViewer.findUnique({
      where: { streamId_viewerId: { streamId, viewerId } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.streamViewer.update({
        where: { id: existing.id },
        data: { leftAt: null },
      });
      return { firstView: false };
    }

    await this.prisma.$transaction([
      this.prisma.streamViewer.create({
        data: { streamId, viewerId },
      }),
      this.prisma.liveStream.update({
        where: { id: streamId },
        data: { totalViews: { increment: 1 } },
      }),
    ]);
    return { firstView: true };
  }

  /**
   * Mark a viewer session as ended. Returns false when the user was not watching.
   */
  async markViewerLeft(streamId: string, viewerId: string) {
    const result = await this.prisma.streamViewer.updateMany({
      where: { streamId, viewerId, leftAt: null },
      data: { leftAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * Persist the current live viewer count and keep the peak up to date
   */
  async updateViewerStats(streamId: string, viewerCount: number) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { peakViewers: true, status: true },
    });

    if (!stream || stream.status !== 'LIVE') {
      return;
    }

    await this.prisma.liveStream.update({
      where: { id: streamId },
      data: {
        viewerCount,
        peakViewers: Math.max(stream.peakViewers, viewerCount),
      },
    });
  }

  /**
   * Close every open viewer session of a stream (used when the stream ends)
   */
  async closeViewerSessions(streamId: string) {
    await this.prisma.streamViewer.updateMany({
      where: { streamId, leftAt: null },
      data: { leftAt: new Date() },
    });
  }

  /**
   * Persist a chat message sent in a live stream
   */
  async createChatMessage(streamId: string, senderId: string, message: string) {
    const text = typeof message === 'string' ? message.trim() : '';

    if (!text) {
      throw new BadRequestException('Message cannot be empty');
    }

    if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new BadRequestException(`Message cannot exceed ${MAX_CHAT_MESSAGE_LENGTH} characters`);
    }

    return this.prisma.streamMessage.create({
      data: { streamId, senderId, message: text },
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
  }

  /**
   * Latest chat messages of a stream, oldest first
   */
  async getRecentChatMessages(streamId: string, limit = 50) {
    const messages = await this.prisma.streamMessage.findMany({
      where: { streamId },
      orderBy: { createdAt: 'desc' },
      take: limit,
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
    return messages.reverse();
  }

  private async getActiveSubscriptions(userId: string, creatorId: string) {
    return this.prisma.subscription.findMany({
      where: {
        subscriberId: userId,
        status: 'ACTIVE',
        currentPeriodEnd: { gte: new Date() },
        tier: { creatorId },
      },
      select: {
        id: true,
        tier: { select: { price: true } },
      },
    });
  }

  /**
   * Buy access to a PPV stream. Returns a pending payment to confirm
   * client-side; access is granted once Stripe confirms it (webhook or
   * confirmStreamPurchase), through a COMPLETED PPV_UNLOCK transaction whose
   * contentId is the stream id.
   */
  async purchaseStream(userId: string, streamId: string, paymentMethodId?: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: {
        id: true,
        title: true,
        creatorId: true,
        visibility: true,
        isPpv: true,
        ppvPrice: true,
        status: true,
        creator: { select: { username: true } },
      },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (!stream.isPpv || !stream.ppvPrice || Number(stream.ppvPrice) <= 0) {
      throw new BadRequestException('This stream is not pay-per-view');
    }

    if (stream.creatorId === userId) {
      throw new BadRequestException('You cannot buy your own stream');
    }

    if (stream.status === 'ENDED' || stream.status === 'CANCELLED') {
      throw new BadRequestException('This stream is over');
    }

    const access = await this.checkViewAccess(userId, stream);
    if (access.allowed) {
      return { purchased: true, alreadyPurchased: true, streamId };
    }

    // Other requirements (subscription, private) cannot be bought here
    if (access.reason !== 'PPV_PURCHASE_REQUIRED') {
      throw new ForbiddenException(access.reason ?? 'Access denied');
    }

    const payment = await this.oneTimePayments.startPayment({
      payerId: userId,
      creatorId: stream.creatorId,
      kind: 'stream_access',
      amount: Number(stream.ppvPrice),
      contentId: stream.id,
      paymentMethodId,
      description: `Live PPV de @${stream.creator.username} : ${stream.title}`,
      metadata: { streamId: stream.id },
    });

    this.logger.log(`Stream purchase started: ${streamId} by user ${userId} (${payment.status})`);

    return { ...payment, purchased: payment.completed, alreadyPurchased: false, streamId };
  }

  /**
   * Re-check a PPV stream payment with Stripe after client-side confirmation (idempotent)
   */
  async confirmStreamPurchase(userId: string, streamId: string, paymentIntentId: string) {
    const payment = await this.oneTimePayments.confirmPayment(userId, paymentIntentId, {
      kind: 'stream_access',
      contentId: streamId,
    });

    return { ...payment, purchased: payment.completed, streamId };
  }

  /**
   * Delete a stream (creator only)
   */
  async deleteStream(userId: string, streamId: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { creatorId: true, status: true },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.creatorId !== userId) {
      throw new ForbiddenException('You can only delete your own streams');
    }

    if (stream.status === 'LIVE') {
      throw new BadRequestException('Cannot delete live streams. End the stream first.');
    }

    await this.prisma.liveStream.delete({
      where: { id: streamId },
    });

    this.logger.log(`Stream deleted: ${streamId} by user ${userId}`);
    return { message: 'Stream deleted successfully' };
  }
}
