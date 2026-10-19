import { IsNumber, IsString, IsEnum, IsOptional, IsUUID, IsPositive, Min, Max, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class RequestPayoutDto {
  // Euros
  // The minimum is a platform setting (minimumPayoutAmount), checked by the service
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

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

  // Saved card (GET /payments/methods); without it the client confirms with Stripe Elements
  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}

export class OneTimePaymentDto {
  // Saved card (GET /payments/methods); without it the client confirms with Stripe Elements
  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}

export class ConfirmPaymentDto {
  @IsString()
  paymentIntentId: string;
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
}
