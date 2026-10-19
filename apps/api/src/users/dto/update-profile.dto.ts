import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Empty strings / null clear the field (see UsersService.updateProfile) */
const isSet = (value: unknown) => value !== undefined && value !== null && value !== '';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ValidateIf((o) => isSet(o.website))
  @IsUrl({ protocols: ['http', 'https'] }, { message: "L'adresse du site web est invalide (ex. https://exemple.com)" })
  @MaxLength(200)
  website?: string | null;

  // Profile images: set by POST /users/profile/avatar|cover; empty / null removes them
  @ValidateIf((o) => isSet(o.avatar))
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  @MaxLength(2048)
  avatar?: string | null;

  @ValidateIf((o) => isSet(o.coverImage))
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  @MaxLength(2048)
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

  @IsOptional()
  @IsBoolean()
  autoAcceptSubscribers?: boolean;
}

export const CREATOR_PROFILE_FIELDS = [
  'autoAcceptSubscribers',
  'welcomeMessage',
  'allowMessages',
  'allowTips',
  'minimumTip',
] as const;
