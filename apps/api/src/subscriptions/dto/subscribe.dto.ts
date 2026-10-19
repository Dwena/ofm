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
