import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StripeService } from '../payments/stripe.service';

// Stripe itself expires an unpaid first invoice after 23 hours
export const ABANDONED_INCOMPLETE_AFTER_HOURS = 23;

/**
 * Cleans up paid subscriptions whose checkout was abandoned: subscribe creates
 * a Stripe subscription left `incomplete` until the first payment is confirmed,
 * and no local row exists for it until then.
 */
@Injectable()
export class SubscriptionCleanupService {
  private readonly logger = new Logger(SubscriptionCleanupService.name);

  constructor(private stripeService: StripeService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cancelAbandonedIncompleteSubscriptions() {
    const createdBefore =
      Math.floor(Date.now() / 1000) - ABANDONED_INCOMPLETE_AFTER_HOURS * 60 * 60;

    let candidates;
    try {
      candidates = await this.stripeService.listIncompleteSubscriptions({ createdBefore });
    } catch (error) {
      this.logger.error(`Failed to list incomplete subscriptions: ${error.message}`);
      return { cancelledCount: 0, failedCount: 0 };
    }

    let cancelledCount = 0;
    let failedCount = 0;

    for (const subscription of candidates) {
      // Only the ones created by subscribe
      if (subscription.metadata?.platform !== 'ofm' || !subscription.metadata?.subscriberId) {
        continue;
      }

      try {
        await this.stripeService.cancelSubscription(subscription.id);
        cancelledCount++;
      } catch (error) {
        failedCount++;
        this.logger.error(
          `Failed to cancel incomplete subscription ${subscription.id}: ${error.message}`,
        );
      }
    }

    if (cancelledCount || failedCount) {
      this.logger.log(
        `Abandoned incomplete subscriptions cancelled: ${cancelledCount}, failed: ${failedCount}`,
      );
    }

    return { cancelledCount, failedCount };
  }
}
