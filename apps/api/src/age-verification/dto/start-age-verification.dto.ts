import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartAgeVerificationDto {
  /** Web path to come back to once verified (relative path only) */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  returnTo?: string;
}
