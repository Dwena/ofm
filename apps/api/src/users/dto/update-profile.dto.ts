import {
  IsString,
  IsOptional,
  MaxLength,
  IsUrl,
  IsBoolean,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  // null clears the website
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'] })
  website?: string | null;

  // Profile images: set by POST /users/profile/avatar|cover, null removes them
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  avatar?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  coverImage?: string | null;

  // Creator settings (CreatorProfile), creators only
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  welcomeMessage?: string | null;

  @IsOptional()
  @IsBoolean()
  allowMessages?: boolean;

  @IsOptional()
  @IsBoolean()
  allowTips?: boolean;

  // Euros, at least the platform minimum tip (1 €)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10000)
  minimumTip?: number;
}

export const CREATOR_PROFILE_FIELDS = [
  'welcomeMessage',
  'allowMessages',
  'allowTips',
  'minimumTip',
] as const;
