import { Body, Controller, Get, Inject, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../common/database/prisma.service';
import { FAKE_CHECKOUT_PREFIX, FakePaymentProvider } from './providers/fake.provider';
import { PAYMENT_PROVIDER, PaymentProvider } from './providers/payment-provider';
import { PaymentEventsService } from './payment-events.service';
import { PaymentFlowService } from './payment-flow.service';

export class SimulatorPayDto {
  /** Last 4 digits of the test card (4242: approved, 0002: declined) */
  @IsOptional()
  @Matches(/^\d{4}$/)
  last4?: string;
}

/**
 * Hosted payment page of the payment simulator (PAYMENT_PROVIDER=fake, never
 * in production): the web page /checkout/simulateur approves or declines the
 * payment here, which produces the same events as a provider webhook.
 */
@Controller('payments/simulator')
@UseGuards(JwtAuthGuard)
export class PaymentSimulatorController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
    private prisma: PrismaService,
    private events: PaymentEventsService,
    private paymentFlow: PaymentFlowService,
  ) {}

  @Get('sessions/:sessionId')
  async getSession(@CurrentUser('id') userId: string, @Param('sessionId') sessionId: string) {
    const transaction = await this.findTransaction(userId, sessionId);
    const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
    return {
      transactionId: transaction.id,
      description: metadata.description ?? 'Paiement',
      amount: Number(transaction.amount),
      vatRate: Number(transaction.vatRate),
      vatAmount: Number(transaction.vatAmount),
      totalAmount: Number(transaction.totalAmount),
      status: transaction.status,
    };
  }

  @Post('sessions/:sessionId/approve')
  async approve(@CurrentUser('id') userId: string, @Param('sessionId') sessionId: string, @Body() dto: SimulatorPayDto) {
    const transaction = await this.findTransaction(userId, sessionId);
    const last4 = dto.last4 ?? '4242';

    if (last4 === '0002') {
      await this.events.dispatch({ type: 'payment.failed', reference: transaction.id, reason: 'Carte refusée par la banque (simulation)' });
    } else {
      const chargeId = FakePaymentProvider.transactionId();
      await this.events.dispatch({
        type: 'payment.succeeded',
        reference: transaction.id,
        providerPaymentId: sessionId,
        providerTransactionId: chargeId,
        amount: Number(transaction.totalAmount),
        currency: transaction.currency,
        // Authentication of an already saved card: no new card
        ...(!transaction.paymentCardId && {
          card: {
            token: FakePaymentProvider.cardToken(last4),
            brand: 'visa',
            last4,
            expMonth: 12,
            expYear: new Date().getFullYear() + 3,
            country: null,
          },
        }),
      });
    }

    return this.paymentFlow.confirmPayment(userId, transaction.id);
  }

  @Post('sessions/:sessionId/cancel')
  async cancel(@CurrentUser('id') userId: string, @Param('sessionId') sessionId: string) {
    const transaction = await this.findTransaction(userId, sessionId);
    await this.paymentFlow.markFailed(transaction.id, 'Paiement annulé');
    return this.paymentFlow.confirmPayment(userId, transaction.id);
  }

  private async findTransaction(userId: string, sessionId: string) {
    if (this.provider.name !== 'fake' || !this.provider.isConfigured() || !sessionId.startsWith(FAKE_CHECKOUT_PREFIX)) {
      throw new NotFoundException();
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: sessionId.slice(FAKE_CHECKOUT_PREFIX.length) },
    });
    if (!transaction || transaction.fromUserId !== userId) {
      throw new NotFoundException('Payment not found');
    }
    return transaction;
  }
}
