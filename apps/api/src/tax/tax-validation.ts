import { isISO31661Alpha2 } from 'class-validator';

/**
 * Validation of the creators' tax profile (DAC7 identity, bank account).
 *
 * Pure functions: they are shared by the service (format checks on save,
 * completeness) and unit-tested without a database.
 */

export type EntityType = 'individual' | 'company';
export type VatRegime = 'franchise' | 'subject';

/** EU member states (ISO 3166-1 alpha-2) */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

/** European Economic Area: EU + Iceland, Liechtenstein, Norway */
export const EEA_COUNTRIES: ReadonlySet<string> = new Set([...EU_COUNTRIES, 'IS', 'LI', 'NO']);

/**
 * IBAN length of the countries of the SEPA schemes. The platform pays creators
 * by SEPA credit transfer only. Keep in sync with the EPC list of SEPA
 * countries (europeanpaymentscouncil.eu); AL, MD, ME and MK joined in 2025.
 * French overseas departments, Saint-Barthélemy, Saint-Pierre-et-Miquelon...
 * use FR IBANs.
 */
export const SEPA_IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AL: 28, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22,
  IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19,
  MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  VA: 22,
};

/** Upper-case and remove spaces, dots, dashes (as typed by users) */
export function compact(value: string | null | undefined): string {
  return (value ?? '').replace(/[\s.\-]/g, '').toUpperCase();
}

export function isCountryCode(value: string | null | undefined): boolean {
  return !!value && /^[A-Z]{2}$/.test(value) && isISO31661Alpha2(value);
}

// ==================== Bank details ====================

/** ISO 13616 checksum (mod 97 = 1) */
export function ibanChecksumValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : char;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** Normalized IBAN, or an error message (French, shown to the creator) */
export function validateIban(input: string): { iban: string } | { error: string } {
  const iban = compact(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) {
    return { error: 'IBAN invalide' };
  }
  const country = iban.slice(0, 2);
  const length = SEPA_IBAN_LENGTHS[country];
  if (!length) {
    return { error: 'Seuls les comptes bancaires de la zone SEPA sont acceptés' };
  }
  if (iban.length !== length) {
    return { error: `Un IBAN ${country} comporte ${length} caractères` };
  }
  if (!ibanChecksumValid(iban)) {
    return { error: 'IBAN invalide (clé de contrôle incorrecte)' };
  }
  return { iban };
}

export function isValidIban(input: string): boolean {
  return 'iban' in validateIban(input);
}

/** BIC / SWIFT code: 8 or 11 characters (ISO 9362) */
export function isValidBic(input: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(input));
}

/**
 * Transfers to SEPA countries outside the EEA (Switzerland, United Kingdom,
 * Monaco...) need the BIC of the beneficiary's bank
 */
export function bicRequiredForIban(iban: string): boolean {
  return !EEA_COUNTRIES.has(iban.slice(0, 2).toUpperCase());
}

// ==================== Company / tax identifiers ====================

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** French SIREN (9 digits) or SIRET (14 digits), Luhn checksum */
export function isValidSirenOrSiret(input: string): boolean {
  const value = compact(input);
  if (/^\d{9}$/.test(value)) return luhnValid(value);
  if (/^\d{14}$/.test(value)) {
    // La Poste establishments (SIREN 356 000 000) do not follow Luhn: the sum of the digits is a multiple of 5
    if (value.startsWith('356000000') && value !== '35600000000048') {
      return [...value].reduce((sum, d) => sum + Number(d), 0) % 5 === 0;
    }
    return luhnValid(value);
  }
  return false;
}

/** French tax number of individuals (numéro fiscal / SPI): 13 digits, first one 0 to 3 */
export function isValidFrenchTin(input: string): boolean {
  return /^[0-3]\d{12}$/.test(compact(input));
}

/** EU VAT number prefixes (Greece uses EL, Northern Ireland XI) */
const VAT_PREFIXES = new Set([...EU_COUNTRIES].filter((c) => c !== 'GR').concat(['EL', 'XI']));

/**
 * VAT number: strict format for EU numbers (with the key of French numbers),
 * lenient for other countries (UK, Switzerland... numbers are kept as typed)
 */
export function isValidVatNumber(input: string): boolean {
  const value = compact(input);
  const prefix = value.slice(0, 2);
  if (!VAT_PREFIXES.has(prefix)) {
    return /^[A-Z0-9]{4,20}$/.test(value);
  }
  if (prefix === 'FR') {
    const match = /^FR([0-9A-HJ-NP-Z]{2})(\d{9})$/.exec(value);
    if (!match) return false;
    const [, key, siren] = match;
    if (/^\d{2}$/.test(key)) {
      return Number(key) === (12 + 3 * (Number(siren) % 97)) % 97;
    }
    return true; // alphanumeric keys (rare, old numbers) have no public algorithm
  }
  return /^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(value);
}

// ==================== Profile ====================

/** Fields of the tax profile, as stored (IBAN reduced to its presence) */
export interface TaxProfileFields {
  entityType: string;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: Date | null;
  placeOfBirth?: string | null;
  companyName?: string | null;
  companyRegistrationNumber?: string | null;
  vatNumber?: string | null;
  vatRegime: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  taxIdentificationNumber?: string | null;
  tinCountry?: string | null;
  tinNotIssued: boolean;
  accountHolderName?: string | null;
  hasIban: boolean;
  bic?: string | null;
  /** The current version of the self-billing mandate is accepted */
  selfBillingAccepted: boolean;
}

export const MINIMUM_AGE = 18;

/** Age in full years at `now` (UTC) */
export function ageAt(dateOfBirth: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

const filled = (value: string | null | undefined) => !!value && value.trim().length > 0;

/**
 * Format checks of the values being saved (a draft may be incomplete, but
 * what is filled in must be valid). Returns { field: message }.
 */
export function validateTaxProfileFields(p: TaxProfileFields, now = new Date()): Record<string, string> {
  const errors: Record<string, string> = {};

  if (p.entityType !== 'individual' && p.entityType !== 'company') {
    errors.entityType = 'Type de vendeur invalide';
  }
  if (p.vatRegime !== 'franchise' && p.vatRegime !== 'subject') {
    errors.vatRegime = 'Régime de TVA invalide';
  }

  for (const field of ['country', 'tinCountry'] as const) {
    if (filled(p[field]) && !isCountryCode(p[field])) {
      errors[field] = 'Code pays invalide (ISO 3166, ex. FR)';
    }
  }

  if (p.dateOfBirth) {
    const time = p.dateOfBirth.getTime();
    if (Number.isNaN(time) || p.dateOfBirth.getUTCFullYear() < 1900 || p.dateOfBirth > now) {
      errors.dateOfBirth = 'Date de naissance invalide';
    } else if (ageAt(p.dateOfBirth, now) < MINIMUM_AGE) {
      errors.dateOfBirth = 'Vous devez avoir au moins 18 ans';
    }
  }

  if (p.country === 'FR' && filled(p.postalCode) && !/^\d{5}$/.test(p.postalCode!.trim())) {
    errors.postalCode = 'Code postal invalide';
  }

  if (filled(p.companyRegistrationNumber)) {
    if (p.country === 'FR') {
      if (!isValidSirenOrSiret(p.companyRegistrationNumber!)) {
        errors.companyRegistrationNumber = 'Numéro SIREN (9 chiffres) ou SIRET (14 chiffres) invalide';
      }
    } else if (!/^[A-Z0-9/]{2,30}$/.test(compact(p.companyRegistrationNumber))) {
      errors.companyRegistrationNumber = "Numéro d'immatriculation invalide";
    }
  }

  if (filled(p.taxIdentificationNumber)) {
    if (p.tinCountry === 'FR') {
      if (!isValidFrenchTin(p.taxIdentificationNumber!)) {
        errors.taxIdentificationNumber =
          'Numéro fiscal invalide : 13 chiffres commençant par 0, 1, 2 ou 3 (voir votre avis d’impôt)';
      }
    } else if (!/^[A-Z0-9/]{3,30}$/.test(compact(p.taxIdentificationNumber))) {
      errors.taxIdentificationNumber = "Numéro d'identification fiscale invalide";
    }
  }

  if (filled(p.vatNumber) && !isValidVatNumber(p.vatNumber!)) {
    errors.vatNumber = 'Numéro de TVA intracommunautaire invalide';
  }

  if (filled(p.bic) && !isValidBic(p.bic!)) {
    errors.bic = 'BIC invalide (8 ou 11 caractères)';
  }

  return errors;
}

/**
 * Required fields still missing for a complete profile (payouts are blocked
 * until the list is empty). Keys are the form field names.
 *
 * DAC7 (art. 1649 ter C CGI): individuals give their name, date of birth,
 * address and TIN (or place of birth when their country issues no TIN);
 * entities their name, registration number, address and TIN or VAT number.
 * The bank account the consideration is paid to is reportable as well.
 */
export function computeMissingFields(p: TaxProfileFields): string[] {
  const missing: string[] = [];
  const need = (field: string, value: string | null | undefined | Date) => {
    if (value instanceof Date ? Number.isNaN(value.getTime()) : !filled(value as string)) missing.push(field);
  };

  if (p.entityType === 'company') {
    need('companyName', p.companyName);
    need('companyRegistrationNumber', p.companyRegistrationNumber);
    if (!filled(p.taxIdentificationNumber) && !filled(p.vatNumber)) {
      missing.push('taxIdentificationNumber');
    }
  } else {
    need('firstName', p.firstName);
    need('lastName', p.lastName);
    if (!p.dateOfBirth) missing.push('dateOfBirth');
    if (p.tinNotIssued) {
      need('placeOfBirth', p.placeOfBirth);
    } else {
      need('taxIdentificationNumber', p.taxIdentificationNumber);
    }
  }
  if (filled(p.taxIdentificationNumber)) {
    need('tinCountry', p.tinCountry);
  }

  need('addressLine1', p.addressLine1);
  need('postalCode', p.postalCode);
  need('city', p.city);
  need('country', p.country);

  if (p.vatRegime === 'subject') {
    need('vatNumber', p.vatNumber);
  }

  need('accountHolderName', p.accountHolderName);
  if (!p.hasIban) missing.push('iban');
  if (!p.selfBillingAccepted) missing.push('selfBillingAccepted');

  return [...new Set(missing)];
}
