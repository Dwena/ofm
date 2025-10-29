import {
  Controller,
  Post,
  Body,
  Headers,
  RawBodyRequest,
  Req,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private stripeWebhookService: StripeWebhookService) {}

  @Post()
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    if (!signature) {
      this.logger.error('Missing stripe-signature header');
      throw new BadRequestException('Missing stripe-signature header');
    }

    try {
      if (!request.rawBody) {
        throw new BadRequestException('Missing request body');
      }

      // Verify and handle the webhook
      const result = await this.stripeWebhookService.handleWebhook(
        request.rawBody,
        signature,
      );

      this.logger.log(`Webhook processed: ${result.type}`);

      return { received: true, type: result.type };
    } catch (error) {
      this.logger.error(`Webhook error: ${error.message}`, error.stack);
      throw new BadRequestException(`Webhook error: ${error.message}`);
    }
  }
}
