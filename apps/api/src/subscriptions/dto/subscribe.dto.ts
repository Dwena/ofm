import { IsString, IsUUID, IsOptional, IsNotEmpty } from 'class-validator';

export class SubscribeDto {
  @IsUUID()
  tierId: string;

  // Saved card to charge right away; otherwise the client confirms the payment with Stripe Elements
  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}

export class ConfirmSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  stripeSubscriptionId: string;
}

export class ChangeTierDto {
  @IsUUID()
  tierId: string;

  // Free → paid only (a new Stripe subscription is created): saved card to charge
  // right away. Paid → paid changes charge the card attached to the subscription.
  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}

export class RetryPaymentDto {
  // Saved card to pay with (it becomes the subscription's card); defaults to the current one
  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}
