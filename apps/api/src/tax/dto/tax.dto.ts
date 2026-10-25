import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * Tax profile form. Every field is optional so the creator can save a draft:
 * an omitted field is left unchanged, null or '' clears it. The detailed
 * checks (IBAN, SIREN, TIN...) are done by the service (tax-validation.ts).
 *
 * `iban`: omitted or '' keeps the saved account (it is never sent back to the
 * browser), null removes it.
 */
export class UpdateTaxProfileDto {
  @IsOptional()
  @IsIn(['individual', 'company'])
  entityType?: 'individual' | 'company';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string | null;

  /** YYYY-MM-DD */
  @IsOptional()
  @IsString()
  @Matches(/^(\d{4}-\d{2}-\d{2})?$/, { message: 'dateOfBirth must be a YYYY-MM-DD date' })
  dateOfBirth?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  placeOfBirth?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  companyRegistrationNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  vatNumber?: string | null;

  @IsOptional()
  @IsIn(['franchise', 'subject'])
  vatRegime?: 'franchise' | 'subject';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxIdentificationNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  tinCountry?: string | null;

  @IsOptional()
  @IsBoolean()
  tinNotIssued?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  accountHolderName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  iban?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  bic?: string | null;

  /** Acceptance of the current self-billing mandate (false revokes it) */
  @IsOptional()
  @IsBoolean()
  selfBillingAccepted?: boolean;
}

export class TaxYearQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year: number;
}

export class Dac7ExportQueryDto extends TaxYearQueryDto {
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}

export class GenerateInvoicesDto {
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year: number;

  /** 1-12 */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}
