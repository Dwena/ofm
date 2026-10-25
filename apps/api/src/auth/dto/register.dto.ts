import {
  Equals,
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsIn,
  IsOptional,
  Matches,
  ValidateIf,
} from 'class-validator';
import { UserRole } from '../decorators/roles.decorator';

export class RegisterDto {
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;

  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters' })
  @MaxLength(30, { message: 'Username must be at most 30 characters' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Username can only contain letters, numbers, underscores and hyphens',
  })
  username: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
  })
  password: string;

  // Only fan and creator accounts can be self-registered (never ADMIN / MODERATOR)
  @IsIn([UserRole.SUBSCRIBER, UserRole.CREATOR], { message: 'Invalid role' })
  @IsOptional()
  role?: UserRole = UserRole.SUBSCRIBER;

  /** "J'ai lu et j'accepte les CGU et la Politique de confidentialité" */
  @Equals(true, { message: 'You must accept the terms of use and the privacy policy' })
  acceptTerms: boolean;

  /** "Je certifie avoir 18 ans ou plus" */
  @Equals(true, { message: 'You must certify that you are at least 18 years old' })
  confirmAdult: boolean;

  /** "J'accepte les Conditions créateurs": required for creator accounts */
  @ValidateIf((dto: RegisterDto) => dto.role === UserRole.CREATOR)
  @Equals(true, { message: 'You must accept the creator terms' })
  acceptCreatorTerms?: boolean;
}
