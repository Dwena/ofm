import { IsString, IsNumber, IsArray, IsBoolean, IsOptional, IsEnum, Min } from 'class-validator';

export enum TierInterval {
  MONTH = 'month',
  YEAR = 'year',
}

export class CreateTierDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number; // in cents

  @IsString()
  @IsOptional()
  currency?: string;

  @IsEnum(TierInterval)
  @IsOptional()
  interval?: TierInterval;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  benefits?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateTierDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number; // in cents

  @IsString()
  @IsOptional()
  currency?: string;

  @IsEnum(TierInterval)
  @IsOptional()
  interval?: TierInterval;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  benefits?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
