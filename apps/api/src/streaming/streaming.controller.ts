import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { StreamingService } from './streaming.service';
import { StreamingGateway } from './streaming.gateway';
import { IceServersService } from './ice-servers.service';
import { LiveKitTokenDto } from './dto/livekit-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateStreamDto, ModeratorEndStreamDto, UpdateStreamDto } from './dto/create-stream.dto';
import { ConfirmPaymentDto, OneTimePaymentDto } from '../payments/dto/payments.dto';
import { paymentContext } from '../payments/payment-context';
import { Request } from 'express';
import { StartStreamDto } from './dto/live-ingress.dto';
import { LiveIngressService } from './live-ingress.service';
import { AgeVerified } from '../age-verification/decorators/age-verified.decorator';
import { gateStream, gateStreams } from '../age-verification/age-gate';
import { AGE_VERIFICATION_REQUIRED } from '../age-verification/age-verification.constants';

@Controller('streaming')
@UseGuards(JwtAuthGuard)
export class StreamingController {
  constructor(
    private readonly streamingService: StreamingService,
    private readonly streamingGateway: StreamingGateway,
    private readonly iceServersService: IceServersService,
    private readonly liveIngress: LiveIngressService,
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
   * "Diffuser avec OBS": the creator's RTMP ingress (server URL, stream key,
   * OBS status), created on first call. The stream key is
   * a secret: only ever returned here, to its creator. 400 INGRESS_UNAVAILABLE
   * without LiveKit (P2P mode). Declared before `:id`.
   */
  @Get('me/ingress')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  getMyIngress(@CurrentUser('id') userId: string) {
    return this.liveIngress.getIngress(userId);
  }

  /**
   * New stream key (the old one stops working immediately)
   */
  @Post('me/ingress/reset-key')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  resetMyIngressKey(@CurrentUser('id') userId: string) {
    return this.liveIngress.resetKey(userId);
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
    const stream = await this.streamingService.createStream(userId, dto);
    // A live started right away: the creator's OBS overlays switch to it
    this.streamingGateway.notifyStreamStarted(stream);
    return stream;
  }

  /**
   * Get live streams
   */
  @Get('live')
  async getLiveStreams(@CurrentUser('id') userId: string, @AgeVerified() ageVerified: boolean) {
    const streams = await this.streamingService.getLiveStreams(userId);
    return gateStreams(streams, { viewerId: userId, ageVerified });
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
    @AgeVerified() ageVerified: boolean,
  ) {
    const streams = await this.streamingService.getCreatorStreams(creatorId, userId);
    return gateStreams(streams, { viewerId: userId, ageVerified });
  }

  /**
   * Get a single stream
   */
  @Get(':id')
  async getStreamById(
    @Param('id') streamId: string,
    @CurrentUser('id') userId: string,
    @AgeVerified() ageVerified: boolean,
  ) {
    const stream = await this.streamingService.getStreamById(streamId, userId);
    return gateStream(stream, { viewerId: userId, ageVerified });
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
    @Body() dto: StartStreamDto,
  ) {
    const stream = await this.streamingService.startStream(userId, streamId, dto?.source);
    this.streamingGateway.notifyStreamStarted(stream);
    return stream;
  }

  /**
   * Moderators / admins cut a live in progress (or cancel an announced one).
   * Lives are monitored in real time by the moderation team: they cannot be
   * reviewed before they happen.
   */
  @Post(':id/moderation/end')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async moderatorEndStream(
    @CurrentUser('id') moderatorId: string,
    @Param('id') streamId: string,
    @Body() dto: ModeratorEndStreamDto,
  ) {
    await this.streamingGateway.flushViewerStats(streamId);
    const stream = await this.streamingService.moderatorEndStream(moderatorId, streamId, dto?.reason);
    this.streamingGateway.notifyStreamEnded(streamId);
    return stream;
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
    @AgeVerified() ageVerified: boolean,
  ) {
    // Watching a live needs a verified age (the creator broadcasting their own live does not)
    if (!ageVerified) {
      const stream = await this.streamingService.getStreamForRealtime(streamId);
      if (stream && stream.creatorId !== userId) {
        throw new ForbiddenException({ message: AGE_VERIFICATION_REQUIRED, code: AGE_VERIFICATION_REQUIRED });
      }
    }
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
   * Buy access to a PPV stream (saved card, or the provider's payment page)
   */
  @Post(':id/purchase')
  async purchaseStream(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
    @Body() dto: OneTimePaymentDto,
    @Req() request: Request,
  ) {
    return this.streamingService.purchaseStream(userId, streamId, { ...dto, ...paymentContext(request) });
  }

  /**
   * State of the PPV stream payment (idempotent)
   */
  @Post(':id/purchase/confirm')
  async confirmStreamPurchase(
    @CurrentUser('id') userId: string,
    @Param('id') streamId: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.streamingService.confirmStreamPurchase(userId, streamId, dto.transactionId);
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
