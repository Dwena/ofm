import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentEventsService } from './payment-events.service';
import { PAYMENT_PROVIDER, PaymentEvent, PaymentProvider, PaymentProviderError } from './providers/payment-provider';

/**
 * Webhooks of the payment provider: POST /webhooks/payments/<provider>
 * (e.g. /api/v1/webhooks/payments/ccbill?token=<CCBILL_WEBHOOK_TOKEN>)
 */
@Controller('webhooks/payments')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
    private events: PaymentEventsService,
  ) {}

  @Post(':provider')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  async handle(@Param('provider') providerName: string, @Req() request: RawBodyRequest<Request>) {
    if (providerName !== this.provider.name) {
      throw new NotFoundException();
    }

    let events: PaymentEvent[];
    try {
      events = await this.provider.parseWebhook({
        headers: request.headers,
        query: request.query as Record<string, unknown>,
        body: request.body,
        rawBody: request.rawBody,
        ip: request.ip,
      });
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        this.logger.warn(`Rejected ${providerName} webhook: ${error.message}`);
        throw new ForbiddenException('Invalid webhook');
      }
      throw new BadRequestException('Malformed webhook');
    }

    for (const event of events) {
      await this.events.dispatch(event);
    }

    return { received: true, events: events.length };
  }
}
