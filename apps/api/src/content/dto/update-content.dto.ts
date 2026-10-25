import { IsString, IsEnum, IsOptional, IsBoolean, IsNumber, Min, IsDate, MaxLength, IsArray, IsUUID, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ContentVisibility } from './create-content.dto';

export class UpdateContentDto {
  @IsEnum(ContentVisibility)
  @IsOptional()
  visibility?: ContentVisibility;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  caption?: string;

  @IsBoolean()
  @IsOptional()
  isPpv?: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  ppvPrice?: number | null;

  /** Future publication date of a draft; null removes the schedule */
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  scheduledFor?: Date | null;

  /** See CreateContentDto.soloContent */
  @IsBoolean()
  @IsOptional()
  soloContent?: boolean;

  /** Replaces the co-performers of the content (verified ones only) */
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  coPerformerIds?: string[];
}
