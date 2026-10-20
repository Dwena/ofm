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
import { SetIngressInputDto, StartStreamDto } from './dto/live-ingress.dto';
import { LiveIngressService } from './live-ingress.service';

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
   * "Diffuser avec OBS": the creator's ingress (server URL, stream key,
   * protocol, OBS status), created as WHIP on first call. The stream key is
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
   * Switch the ingress protocol (WHIP / RTMP): a new LiveKit ingress and a new key
   */
  @Post('me/ingress')
  @UseGuards(RolesGuard)
  @Roles('CREATOR')
  setMyIngressInput(@CurrentUser('id') userId: string, @Body() dto: SetIngressInputDto) {
    return this.liveIngress.setInputType(userId, dto.inputType);
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
    @Body() dto: StartStreamDto,
  ) {
    const stream = await this.streamingService.startStream(userId, streamId, dto?.source);
    this.streamingGateway.notifyStreamStarted(stream);
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
