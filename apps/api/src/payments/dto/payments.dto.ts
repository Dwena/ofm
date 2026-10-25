import {
  IsBoolean,
  IsNumber,
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
  IsPositive,
  Matches,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class RequestPayoutDto {
  // Euros, the whole available balance when omitted
  // The minimum is a platform setting (minimumPayoutAmount), checked by the service
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  note?: string;
}

export class CreateRefundDto {
  @IsString()
  transactionId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  amount?: number; // Euros. If not provided, full refund

  @IsString()
  @IsOptional()
  reason?: string;
}

export enum StatsInterval {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

export class GetStatsDto {
  // The web app sends lowercase intervals (day, week...)
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(StatsInterval)
  @IsOptional()
  interval?: StatsInterval = StatsInterval.MONTH;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(365)
  @IsOptional()
  periods?: number = 12; // Number of periods to return

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;
}

// Mirrors the Prisma TransactionType / TransactionStatus enums
export enum TransactionType {
  SUBSCRIPTION = 'SUBSCRIPTION',
  TIP = 'TIP',
  PPV_UNLOCK = 'PPV_UNLOCK',
  PAYOUT = 'PAYOUT',
  REFUND = 'REFUND',
  PLATFORM_FEE = 'PLATFORM_FEE',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  DISPUTED = 'DISPUTED',
}

export enum TransactionDirection {
  SENT = 'sent',
  RECEIVED = 'received',
}

export class FilterTransactionsDto {
  @IsEnum(TransactionType)
  @IsOptional()
  type?: TransactionType;

  @IsEnum(TransactionStatus)
  @IsOptional()
  status?: TransactionStatus;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  // Paid by the user, or received by the user (earnings, refunds)
  @IsEnum(TransactionDirection)
  @IsOptional()
  direction?: TransactionDirection;

  // Username or display name of the other party
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}

export class SendTipDto {
  // Euros
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10000)
  amount: number;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  message?: string;

  // Live stream the tip was sent from (announced in its chat once paid)
  @IsUUID()
  @IsOptional()
  streamId?: string;

  // Item of the creator's live tip menu the fan pays for (requires streamId)
  @IsUUID()
  @IsOptional()
  menuItemId?: string;

  // Saved card (GET /payments/methods); without it the fan pays on the provider's page
  @IsUUID()
  @IsOptional()
  paymentCardId?: string;

  // Billing country (ISO 3166-1 alpha-2), decides the VAT rate; saved on the account
  @Matches(/^[A-Za-z]{2}$/)
  @IsOptional()
  billingCountry?: string;
}

/** Options of a purchase (PPV content / message / live, subscription) */
export class OneTimePaymentDto {
  // Saved card (GET /payments/methods); without it the fan pays on the provider's page
  @IsUUID()
  @IsOptional()
  paymentCardId?: string;

  // Billing country (ISO 3166-1 alpha-2), decides the VAT rate; saved on the account
  @Matches(/^[A-Za-z]{2}$/)
  @IsOptional()
  billingCountry?: string;

  // The fan asks for immediate access to the digital content and waives the
  // 14-day withdrawal right (art. L221-28 13° Code de la consommation): required
  @IsBoolean()
  @IsOptional()
  withdrawalWaiver?: boolean;
}

export class ConfirmPaymentDto {
  @IsUUID()
  transactionId: string;
}

export class BillingCountryDto {
  @Matches(/^[A-Za-z]{2}$/)
  country: string;
}

export enum CheckoutItemType {
  SUBSCRIPTION = 'subscription',
  PPV = 'ppv',
  STREAM = 'stream',
  TIP = 'tip',
}

export class CheckoutInfoQueryDto {
  @IsEnum(CheckoutItemType)
  type: CheckoutItemType;

  // Tier id, content id, stream id or creator id (tip)
  @IsUUID()
  itemId: string;

  // Country to compute the VAT for (defaults to the fan's billing country)
  @Matches(/^[A-Za-z]{2}$/)
  @IsOptional()
  country?: string;
}

export class AdminPayoutBatchDto {
  // Pending payouts to export; every pending payout when omitted
  @IsUUID('all', { each: true })
  @IsOptional()
  payoutIds?: string[];
}

export class AdminPayoutFailureDto {
  @IsString()
  @MaxLength(300)
  reason: string;
}
