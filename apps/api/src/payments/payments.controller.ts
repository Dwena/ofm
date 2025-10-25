import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Headers,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Stripe Connect - Create account for creator
   */
  @Post('connect/create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async createConnectAccount(@CurrentUser('id') userId: string) {
    return this.paymentsService.createConnectAccount(userId);
  }

  /**
   * Stripe Connect - Get onboarding link
   */
  @Get('connect/onboarding-link')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async getOnboardingLink(@CurrentUser('id') userId: string) {
    return this.paymentsService.getOnboardingLink(userId);
  }

  /**
   * Stripe Connect - Check onboarding status
   */
  @Get('connect/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async getOnboardingStatus(@CurrentUser('id') userId: string) {
    return this.paymentsService.getOnboardingStatus(userId);
  }

  /**
   * Request manual payout
   */
  @Post('payout/request')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async requestPayout(
    @CurrentUser('id') userId: string,
    @Body() body: { amount: number },
  ) {
    return this.paymentsService.requestPayout(userId, body.amount);
  }

  /**
   * Get earnings summary
   */
  @Get('earnings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async getEarnings(@CurrentUser('id') userId: string) {
    return this.paymentsService.getEarnings(userId);
  }

  /**
   * Get transaction history
   */
  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  async getTransactions(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.getTransactions(
      userId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  /**
   * Get payout history
   */
  @Get('payouts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async getPayouts(@CurrentUser('id') userId: string) {
    return this.paymentsService.getPayouts(userId);
  }

  /**
   * Create payment intent (for tips, PPV, etc.)
   */
  @Post('create-intent')
  @UseGuards(JwtAuthGuard)
  async createPaymentIntent(
    @CurrentUser('id') userId: string,
    @Body() body: { amount: number; currency?: string },
  ) {
    return this.paymentsService.createPaymentIntent(
      userId,
      body.amount,
      body.currency,
    );
  }

  /**
   * Stripe webhook endpoint
   */
  @Post('webhook')
  @Public()
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.paymentsService.handleWebhook(signature, req.rawBody!);
  }
}
