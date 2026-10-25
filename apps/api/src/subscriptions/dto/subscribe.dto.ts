import { IsUUID } from 'class-validator';
import { OneTimePaymentDto } from '../../payments/dto/payments.dto';

/**
 * Payment options (saved card, billing country, withdrawal waiver) are those
 * of any purchase: see OneTimePaymentDto
 */
export class SubscribeDto extends OneTimePaymentDto {
  @IsUUID()
  tierId: string;
}

export class ConfirmSubscriptionDto {
  @IsUUID()
  transactionId: string;
}

export class ChangeTierDto extends OneTimePaymentDto {
  @IsUUID()
  tierId: string;
}

/** Paying a past-due subscription (or re-subscribing): saved card, or the provider's page */
export class RetryPaymentDto extends OneTimePaymentDto {}
