import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @Length(64, 64, { message: 'Invalid token' })
  token: string;
}

export class EmailDto {
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(64, 64, { message: 'Invalid token' })
  token: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
  })
  password: string;
}
