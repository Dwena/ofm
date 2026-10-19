import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Query,
  Headers,
  RawBodyRequest,
  Req,
  UseGuards,
  Param,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import {
  RequestPayoutDto,
  CreateRefundDto,
  FilterTransactionsDto,
  GetStatsDto,
  SendTipDto,
  ConfirmPaymentDto,
  CheckoutInfoQueryDto,
} from './dto/payments.dto';
import { CheckoutInfoService } from './checkout-info.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly checkoutInfoService: CheckoutInfoService,
  ) {}

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
    @Body() dto: RequestPayoutDto,
  ) {
    return this.paymentsService.requestPayout(userId, dto.amount);
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
   * Get earnings summary (creator alias)
   */
  @Get('creator/earnings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async getCreatorEarnings(@CurrentUser('id') userId: string) {
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
   * List saved payment methods (cards)
   */
  @Get('methods')
  @UseGuards(JwtAuthGuard)
  async listPaymentMethods(@CurrentUser('id') userId: string) {
    return this.paymentsService.listPaymentMethods(userId);
  }

  /**
   * Create setup intent to add a payment method with Stripe Elements
   */
  @Post('methods/setup-intent')
  @UseGuards(JwtAuthGuard)
  async createSetupIntent(@CurrentUser('id') userId: string) {
    return this.paymentsService.createSetupIntent(userId);
  }

  /**
   * Set default payment method
   */
  @Post('methods/:paymentMethodId/default')
  @UseGuards(JwtAuthGuard)
  async setDefaultPaymentMethod(
    @CurrentUser('id') userId: string,
    @Param('paymentMethodId') paymentMethodId: string,
  ) {
    return this.paymentsService.setDefaultPaymentMethod(userId, paymentMethodId);
  }

  /**
   * Remove a payment method
   */
  @Delete('methods/:paymentMethodId')
  @UseGuards(JwtAuthGuard)
  async deletePaymentMethod(
    @CurrentUser('id') userId: string,
    @Param('paymentMethodId') paymentMethodId: string,
  ) {
    return this.paymentsService.deletePaymentMethod(userId, paymentMethodId);
  }

  /**
   * Send a tip to a creator (amount in euros). Returns a pending payment to
   * confirm client-side; the creator is credited once Stripe confirms it.
   */
  @Post('tip/:creatorId')
  @UseGuards(JwtAuthGuard)
  async sendTip(
    @CurrentUser('id') userId: string,
    @Param('creatorId') creatorId: string,
    @Body() dto: SendTipDto,
  ) {
    return this.paymentsService.sendTip(userId, creatorId, dto);
  }

  /**
   * Re-check a tip payment with Stripe after client-side confirmation (idempotent)
   */
  @Post('tip/:creatorId/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmTip(
    @CurrentUser('id') userId: string,
    @Param('creatorId') creatorId: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.paymentsService.confirmTip(userId, creatorId, dto.paymentIntentId);
  }

  /**
   * What a checkout is about to charge (server price, tip limits) and whether
   * it can go through (Stripe configured, creator onboarded…)
   */
  @Get('checkout-info')
  @UseGuards(JwtAuthGuard)
  async getCheckoutInfo(
    @CurrentUser('id') userId: string,
    @Query() query: CheckoutInfoQueryDto,
  ) {
    return this.checkoutInfoService.getCheckoutInfo(userId, query.type, query.itemId);
  }

  /**
   * Get filtered transactions
   */
  @Get('transactions/filter')
  @UseGuards(JwtAuthGuard)
  async getFilteredTransactions(
    @CurrentUser('id') userId: string,
    @Query() filters: FilterTransactionsDto,
  ) {
    return this.paymentsService.getFilteredTransactions(userId, filters);
  }

  /**
   * Create refund for a transaction
   */
  @Post('refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async createRefund(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRefundDto,
  ) {
    return this.paymentsService.createRefund(
      userId,
      dto.transactionId,
      dto.amount,
      dto.reason,
    );
  }

  /**
   * Get refund history
   */
  @Get('refunds')
  @UseGuards(JwtAuthGuard)
  async getRefunds(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.getRefunds(
      userId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  /**
   * Get revenue statistics by period
   */
  @Get('stats/revenue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async getRevenueStats(
    @CurrentUser('id') userId: string,
    @Query() filters: GetStatsDto,
  ) {
    return this.paymentsService.getRevenueStats(userId, filters);
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
