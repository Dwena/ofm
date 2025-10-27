import { IsNumber, IsString, IsEnum, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class RequestPayoutDto {
  @IsNumber()
  @Min(10)
  amount: number;

  @IsString()
  @IsOptional()
  note?: string;
}

export class CreateRefundDto {
  @IsString()
  transactionId: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number; // If not provided, full refund

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

export enum TransactionType {
  SUBSCRIPTION = 'SUBSCRIPTION',
  TIP = 'TIP',
  PPV = 'PPV',
  REFUND = 'REFUND',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
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
