import {
  IsString,
  IsNumber,
  IsArray,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export enum TierInterval {
  MONTH = 'month',
  YEAR = 'year',
}

export const TIER_MAX_PRICE = 10000;
export const TIER_MAX_BENEFITS = 20;

export class CreateTierDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(TIER_MAX_PRICE)
  price: number; // in euros (e.g. 9.99)

  @IsString()
  @IsOptional()
  currency?: string;

  @IsEnum(TierInterval)
  @IsOptional()
  interval?: TierInterval;

  @IsArray()
  @ArrayMaxSize(TIER_MAX_BENEFITS)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  benefits?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateTierDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(TIER_MAX_PRICE)
  @IsOptional()
  price?: number; // in euros (e.g. 9.99)

  @IsString()
  @IsOptional()
  currency?: string;

  @IsEnum(TierInterval)
  @IsOptional()
  interval?: TierInterval;

  @IsArray()
  @ArrayMaxSize(TIER_MAX_BENEFITS)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  benefits?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
