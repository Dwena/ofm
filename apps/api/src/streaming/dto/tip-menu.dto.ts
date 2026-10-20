import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const MAX_TIP_MENU_ITEMS = 20;
/** Euros */
export const MAX_TIP_MENU_AMOUNT = 10000;
/** Euros */
export const MAX_TIP_GOAL_AMOUNT = 100000;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class TipMenuItemInputDto {
  // Existing item to keep (its id stays referenced by past tip actions)
  @IsOptional()
  @IsUUID()
  id?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;

  // Euros; the lower bound also depends on the creator's minimum tip (checked by the service)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_TIP_MENU_AMOUNT)
  amount: number;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(16)
  emoji?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReplaceTipMenuDto {
  @IsArray()
  @ArrayMaxSize(MAX_TIP_MENU_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => TipMenuItemInputDto)
  items: TipMenuItemInputDto[];
}

export class UpdateTipGoalDto {
  // Euros, null clears the goal
  @ValidateIf((dto) => dto.amount !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_TIP_GOAL_AMOUNT)
  amount: number | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string | null;
}

export const TIP_ACTION_UPDATE_STATUSES = ['DONE', 'SKIPPED'] as const;
export type TipActionUpdateStatus = (typeof TIP_ACTION_UPDATE_STATUSES)[number];
