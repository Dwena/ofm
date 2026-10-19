import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Le mot de passe actuel est requis' })
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Le nouveau mot de passe doit contenir au moins 8 caractères' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Le nouveau mot de passe doit contenir une majuscule, une minuscule, un chiffre et un caractère spécial (@$!%*?&)',
  })
  newPassword: string;
}

export class DeleteAccountDto {
  @IsString()
  @MinLength(1, { message: 'Le mot de passe est requis' })
  @MaxLength(128)
  password: string;

  /** Required when 2FA is enabled */
  @IsOptional()
  @IsString()
  @Length(6, 6, { message: 'Le code 2FA doit contenir 6 chiffres' })
  totpCode?: string;
}
