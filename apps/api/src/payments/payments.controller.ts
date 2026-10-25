import {
  Controller,
  Post,
  Put,
  Get,
  Delete,
  Body,
  Query,
  Req,
  UseGuards,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  RequestPayoutDto,
  CreateRefundDto,
  FilterTransactionsDto,
  GetStatsDto,
  SendTipDto,
  ConfirmPaymentDto,
  CheckoutInfoQueryDto,
  BillingCountryDto,
} from './dto/payments.dto';
import { CheckoutInfoService } from './checkout-info.service';
import { paymentContext } from './payment-context';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly checkoutInfoService: CheckoutInfoService,
  ) {}

  /**
   * Request a payout of the available balance (SEPA transfer)
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
   * Movements of the creator balance
   */
  @Get('balance/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR')
  async getBalanceHistory(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.getBalanceHistory(
      userId,
      page ? Math.max(1, parseInt(page)) : 1,
      limit ? Math.min(100, Math.max(1, parseInt(limit))) : 20,
    );
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
   * List saved payment methods (cards saved during a payment)
   */
  @Get('methods')
  @UseGuards(JwtAuthGuard)
  async listPaymentMethods(@CurrentUser('id') userId: string) {
    return this.paymentsService.listPaymentMethods(userId);
  }

  /**
   * Set default payment method
   */
  @Post('methods/:paymentCardId/default')
  @UseGuards(JwtAuthGuard)
  async setDefaultPaymentMethod(
    @CurrentUser('id') userId: string,
    @Param('paymentCardId', ParseUUIDPipe) paymentCardId: string,
  ) {
    return this.paymentsService.setDefaultPaymentMethod(userId, paymentCardId);
  }

  /**
   * Remove a payment method
   */
  @Delete('methods/:paymentCardId')
  @UseGuards(JwtAuthGuard)
  async deletePaymentMethod(
    @CurrentUser('id') userId: string,
    @Param('paymentCardId', ParseUUIDPipe) paymentCardId: string,
  ) {
    return this.paymentsService.deletePaymentMethod(userId, paymentCardId);
  }

  /**
   * Billing country of the fan (decides the VAT rate)
   */
  @Put('billing-country')
  @UseGuards(JwtAuthGuard)
  async setBillingCountry(@CurrentUser('id') userId: string, @Body() dto: BillingCountryDto) {
    return this.paymentsService.setBillingCountry(userId, dto.country.toUpperCase());
  }

  /**
   * Send a tip to a creator (amount in euros excluding VAT). Charges the saved
   * card, or returns the provider's payment page to redirect to; the creator
   * is credited once the provider confirms the payment.
   */
  @Post('tip/:creatorId')
  @UseGuards(JwtAuthGuard)
  async sendTip(
    @CurrentUser('id') userId: string,
    @Param('creatorId') creatorId: string,
    @Body() dto: SendTipDto,
    @Req() request: Request,
  ) {
    return this.paymentsService.sendTip(userId, creatorId, dto, paymentContext(request));
  }

  /**
   * State of a tip payment (idempotent)
   */
  @Post('tip/:creatorId/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmTip(
    @CurrentUser('id') userId: string,
    @Param('creatorId') creatorId: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.paymentsService.confirmTip(userId, creatorId, dto.transactionId);
  }

  /**
   * State of any payment of the fan, for the page the provider sends them back to
   */
  @Get('status/:transactionId')
  @UseGuards(JwtAuthGuard)
  async getPaymentStatus(
    @CurrentUser('id') userId: string,
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
  ) {
    return this.paymentsService.getPaymentStatus(userId, transactionId);
  }

  /**
   * What a checkout is about to charge (price, VAT of the fan's country, total)
   * and whether it can go through (payments configured, creator verified…)
   */
  @Get('checkout-info')
  @UseGuards(JwtAuthGuard)
  async getCheckoutInfo(
    @CurrentUser('id') userId: string,
    @Query() query: CheckoutInfoQueryDto,
  ) {
    return this.checkoutInfoService.getCheckoutInfo(userId, query.type, query.itemId, query.country);
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
   * Refund a payment received by the creator (or any payment, for an admin)
   */
  @Post('refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CREATOR', 'ADMIN')
  async createRefund(
    @CurrentUser() user: { id: string; role: string },
    @Body() dto: CreateRefundDto,
  ) {
    return this.paymentsService.createRefund(
      user.id,
      user.role,
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
}
