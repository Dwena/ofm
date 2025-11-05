import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/database/prisma.service';
import { CreateStreamDto, UpdateStreamDto } from './dto/create-stream.dto';
import { nanoid } from 'nanoid';

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
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

    return this.prisma.liveStream.update({
      where: { id: streamId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        duration,
      },
    });
  }

  /**
   * Get active live streams
   */
  async getLiveStreams(userId?: string) {
    return this.prisma.liveStream.findMany({
      where: {
        status: 'LIVE',
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
  }

  /**
   * Get scheduled streams
   */
  async getScheduledStreams(userId?: string) {
    return this.prisma.liveStream.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: {
          gte: new Date(),
        },
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

    return stream;
  }

  /**
   * Join a stream (track viewer)
   */
  async joinStream(userId: string, streamId: string) {
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { status: true, viewerCount: true, peakViewers: true },
    });

    if (!stream) {
      throw new NotFoundException('Stream not found');
    }

    if (stream.status !== 'LIVE') {
      throw new BadRequestException('Stream is not live');
    }

    // Check if already viewing
    const existingViewer = await this.prisma.streamViewer.findUnique({
      where: {
        streamId_viewerId: {
          streamId,
          viewerId: userId,
        },
      },
    });

    if (!existingViewer) {
      // Add viewer and increment counts
      const newViewerCount = stream.viewerCount + 1;
      const newPeakViewers = Math.max(newViewerCount, stream.peakViewers);

      await this.prisma.$transaction([
        this.prisma.streamViewer.create({
          data: {
            streamId,
            viewerId: userId,
          },
        }),
        this.prisma.liveStream.update({
          where: { id: streamId },
          data: {
            viewerCount: newViewerCount,
            peakViewers: newPeakViewers,
            totalViews: { increment: 1 },
          },
        }),
      ]);

      this.logger.log(`User ${userId} joined stream ${streamId}`);
    }

    return { message: 'Joined stream successfully' };
  }

  /**
   * Leave a stream
   */
  async leaveStream(userId: string, streamId: string) {
    const viewer = await this.prisma.streamViewer.findUnique({
      where: {
        streamId_viewerId: {
          streamId,
          viewerId: userId,
        },
      },
    });

    if (viewer) {
      await this.prisma.$transaction([
        this.prisma.streamViewer.update({
          where: { id: viewer.id },
          data: { leftAt: new Date() },
        }),
        this.prisma.liveStream.update({
          where: { id: streamId },
          data: { viewerCount: { decrement: 1 } },
        }),
      ]);

      this.logger.log(`User ${userId} left stream ${streamId}`);
    }

    return { message: 'Left stream successfully' };
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
