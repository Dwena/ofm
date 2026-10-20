import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Optional,
  NotFoundException,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { WebhookEvent } from 'livekit-server-sdk';
import { LiveKitService } from './livekit.service';
import { LiveIngressService } from './live-ingress.service';

/**
 * LiveKit server webhooks (participant joined / left, room finished), used
 * for the number of viewers connected to the video, and the ingress events
 * (OBS status). Configure LiveKit with
 * `webhook.urls: [<API>/api/v1/webhooks/livekit]` and `webhook.api_key`
 * set to LIVEKIT_API_KEY: the Authorization header (JWT signed with the API
 * secret, holding the sha256 of the body) is verified against the raw body.
 */
@Controller('webhooks/livekit')
export class LiveKitWebhookController {
  private readonly logger = new Logger(LiveKitWebhookController.name);

  constructor(
    private readonly liveKit: LiveKitService,
    @Optional() private readonly liveIngress?: LiveIngressService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    if (!this.liveKit.enabled) {
      throw new NotFoundException('LiveKit is not configured');
    }
    if (!authorization) {
      throw new BadRequestException('Missing authorization header');
    }
    if (!request.rawBody) {
      throw new BadRequestException('Missing request body');
    }

    let event: WebhookEvent;
    try {
      event = await this.liveKit.receiveWebhook(request.rawBody.toString('utf8'), authorization);
    } catch (error) {
      this.logger.warn(`Invalid LiveKit webhook: ${error?.message ?? error}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    this.liveKit.handleWebhookEvent(event);
    // OBS status (ingress_started / ingress_ended / tracks of the ingress participant)
    try {
      await this.liveIngress?.handleWebhookEvent(event);
    } catch (error) {
      this.logger.warn(`Unable to handle the ingress webhook ${event.event}: ${error?.message ?? error}`);
    }
    return { received: true, event: event.event };
  }
}
