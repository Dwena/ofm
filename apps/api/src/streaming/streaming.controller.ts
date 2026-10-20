import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { StreamingService } from './streaming.service';
import { StreamingGateway } from './streaming.gateway';
import { IceServersService } from './ice-servers.service';
import { LiveKitTokenDto } from './dto/livekit-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateStreamDto, UpdateStreamDto } from './dto/create-stream.dto';
import { ConfirmPaymentDto, OneTimePaymentDto } from '../payments/dto/payments.dto';

@Controller('streaming')
@UseGuards(JwtAuthGuard)
export class StreamingController {
  constructor(
    private readonly streamingService: StreamingService,
    private readonly streamingGateway: StreamingGateway,
    private readonly iceServersService: IceServersService,
  ) {}

  /**
   * ICE servers for the live WebRTC connections (STUN, plus short-lived TURN
   * credentials when TURN_URLS / TURN_SECRET are configured). Declared before
   * `:id` so it is not taken for a stream id.
   */
  @Get('ice-servers')
  getIceServers(@CurrentUser('id') userId: string) {
    return this.iceServersService.getIceServers(userId);
  }

  /**
   * Create a new live stream (creators only)
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  async createStream(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateStreamDto,
  ) {
    return this.streamingService.createStream(userId, dto);
  }

  /**
   * Get live streams
   */
  @Get('live')
  async getLiveStreams(@CurrentUser('id') userId: string) {
    return this.streamingService.getLiveStreams(userId);
  }

  /**
   * Get scheduled streams
   */
  @Get('scheduled')
  async getScheduledStreams(@CurrentUser('id') userId: string) {
    return this.streamingService.getScheduledStreams(userId);
  }

  /**
   * Get creator's streams
   */
  @Get('creator/:creatorId')
  async getCreatorStreams(
    @Param('creatorId') creatorId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.streamingService.getCreatorStreams(creatorId, userId);
  }

  /**
   * Get a single stream
   */
  @Get(':id')
  async getStreamById(
    @Param('id') streamId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.streamingService.getStreamById(streamId, userId);
  }

  /**
   * Update a stream (creator only)
   */
  @Put(':id')
  async updateStream(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
    @Body() dto: UpdateStreamDto,
  ) {
    return this.streamingService.updateStream(userId, streamId, dto);
  }

  /**
   * Start a stream (creator only)
   */
  @Post(':id/start')
  async startStream(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
  ) {
    return this.streamingService.startStream(userId, streamId);
  }

  /**
   * End a stream (creator only)
   */
  @Post(':id/end')
  async endStream(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
  ) {
    // Write the throttled viewer stats (peak) while the stream is still LIVE
    await this.streamingGateway.flushViewerStats(streamId);
    const stream = await this.streamingService.endStream(userId, streamId);
    this.streamingGateway.notifyStreamEnded(streamId);
    return stream;
  }

  /**
   * LiveKit access token for the live's video (LiveKit transport only):
   * publisher token for the creator, viewer token for anyone allowed to
   * watch. Returns { url, token, room, identity, transport: 'livekit' }.
   */
  @Post(':id/livekit-token')
  async getLiveKitToken(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
    @Body() dto: LiveKitTokenDto,
  ) {
    return this.streamingService.getLiveKitToken(userId, streamId, dto?.role);
  }

  /**
   * Join a stream (start viewing)
   */
  @Post(':id/join')
  async joinStream(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
  ) {
    return this.streamingService.joinStream(userId, streamId);
  }

  /**
   * Leave a stream (stop viewing)
   */
  @Post(':id/leave')
  async leaveStream(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
  ) {
    return this.streamingService.leaveStream(userId, streamId);
  }

  /**
   * Buy access to a PPV stream (pending until Stripe confirms the payment)
   */
  @Post(':id/purchase')
  async purchaseStream(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
    @Body() dto: OneTimePaymentDto,
  ) {
    return this.streamingService.purchaseStream(userId, streamId, dto?.paymentMethodId);
  }

  /**
   * Re-check the PPV stream payment with Stripe and grant access once paid (idempotent)
   */
  @Post(':id/purchase/confirm')
  async confirmStreamPurchase(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.streamingService.confirmStreamPurchase(userId, streamId, dto.paymentIntentId);
  }

  /**
   * Delete a stream (creator only)
   */
  @Delete(':id')
  async deleteStream(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
  ) {
    return this.streamingService.deleteStream(userId, streamId);
  }
}
