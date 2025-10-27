import { IsString, IsEnum, IsOptional, IsBoolean, IsDecimal } from 'class-validator';
import { ContentVisibility } from './create-content.dto';

export class UpdateContentDto {
  @IsEnum(ContentVisibility)
  @IsOptional()
  visibility?: ContentVisibility;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  caption?: string;

  @IsBoolean()
  @IsOptional()
  isPpv?: boolean;

  @IsDecimal()
  @IsOptional()
  ppvPrice?: number;

  @IsOptional()
  scheduledFor?: Date;
}
