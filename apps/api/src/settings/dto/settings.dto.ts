import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SETTING_DEFINITIONS } from '../settings.service';

export class UpdatePlatformSettingsDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  @IsOptional()
  platformFeePercentage?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  @IsOptional()
  minimumPayoutAmount?: number;

  @IsBoolean()
  @IsOptional()
  registrationOpen?: boolean;

  @IsBoolean()
  @IsOptional()
  maintenanceMode?: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @IsOptional()
  maintenanceMessage?: string;
}

export class SettingKeyParamDto {
  @IsIn(Object.keys(SETTING_DEFINITIONS))
  key: string;
}
