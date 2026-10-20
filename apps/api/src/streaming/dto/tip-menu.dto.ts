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

export const MAX_TIP_GOALS = 10;
export const MAX_TIP_GOAL_LABEL_LENGTH = 120;

/** Milestone of a live's donation goal, as sent by the goals editor */
export class TipGoalInputDto {
  // Existing milestone to keep (its reached / done state is preserved)
  @IsOptional()
  @IsUUID()
  id?: string;

  // Euros
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_TIP_GOAL_AMOUNT)
  amount: number;

  // Free text of the creator
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TIP_GOAL_LABEL_LENGTH)
  label: string;
}

export class ReplaceTipGoalsDto {
  @IsArray()
  @ArrayMaxSize(MAX_TIP_GOALS)
  @ValidateNested({ each: true })
  @Type(() => TipGoalInputDto)
  goals: TipGoalInputDto[];
}

export class UpdateTipGoalStatusDto {
  @IsBoolean()
  completed: boolean;
}

export class LatestTipGoalsQueryDto {
  @IsOptional()
  @IsString()
  excludeStreamId?: string;
}

export const TIP_ACTION_UPDATE_STATUSES = ['DONE', 'SKIPPED'] as const;
export type TipActionUpdateStatus = (typeof TIP_ACTION_UPDATE_STATUSES)[number];
