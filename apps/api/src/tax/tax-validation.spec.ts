import {
  TaxProfileFields,
  ageAt,
  bicRequiredForIban,
  computeMissingFields,
  isValidBic,
  isValidFrenchTin,
  isValidIban,
  isValidSirenOrSiret,
  isValidVatNumber,
  validateIban,
  validateTaxProfileFields,
} from './tax-validation';

const NOW = new Date('2026-10-25T12:00:00Z');

const completeIndividual = (): TaxProfileFields => ({
  entityType: 'individual',
  firstName: 'Alice',
  lastName: 'Martin',
  dateOfBirth: new Date('1995-04-12T00:00:00Z'),
  placeOfBirth: null,
  companyName: null,
  companyRegistrationNumber: null,
  vatNumber: null,
  vatRegime: 'franchise',
  addressLine1: '12 rue de la Paix',
  addressLine2: null,
  postalCode: '75002',
  city: 'Paris',
  country: 'FR',
  taxIdentificationNumber: '1234567890123',
  tinCountry: 'FR',
  tinNotIssued: false,
  accountHolderName: 'Alice Martin',
  hasIban: true,
  bic: null,
  selfBillingAccepted: true,
});

describe('tax validation', () => {
  describe('IBAN', () => {
    it.each([
      'FR7630006000011234567890189',
      'FR76 3000 6000 0112 3456 7890 189',
      'de89370400440532013000',
      'GB82WEST12345698765432',
      'CH9300762011623852957',
      'BE68539007547034',
    ])('accepts %s', (iban) => {
      expect(isValidIban(iban)).toBe(true);
    });

    it('normalizes spaces and case', () => {
      expect(validateIban('fr76 3000 6000 0112 3456 7890 189')).toEqual({ iban: 'FR7630006000011234567890189' });
    });

    it('rejects a wrong checksum', () => {
      expect(validateIban('FR7630006000011234567890188')).toEqual({ error: expect.stringContaining('clé de contrôle') });
    });

    it('rejects a wrong length', () => {
      expect(validateIban('FR763000600001123456789018')).toEqual({ error: expect.stringContaining('27 caractères') });
    });

    it('rejects countries outside SEPA', () => {
      expect(validateIban('BR1800360305000010009795493C1')).toEqual({ error: expect.stringContaining('SEPA') });
    });

    it('rejects garbage', () => {
      expect(isValidIban('not an iban')).toBe(false);
      expect(isValidIban('')).toBe(false);
    });

    it('requires a BIC outside the EEA only', () => {
      expect(bicRequiredForIban('FR7630006000011234567890189')).toBe(false);
      expect(bicRequiredForIban('NO9386011117947')).toBe(false);
      expect(bicRequiredForIban('GB82WEST12345698765432')).toBe(true);
      expect(bicRequiredForIban('CH9300762011623852957')).toBe(true);
    });
  });

  describe('BIC', () => {
    it('accepts 8 and 11 characters codes', () => {
      expect(isValidBic('BNPAFRPP')).toBe(true);
      expect(isValidBic('bnpa fr pp xxx')).toBe(true);
    });
    it('rejects malformed codes', () => {
      expect(isValidBic('BNPAFR')).toBe(false);
      expect(isValidBic('BNPAFRPPXX')).toBe(false);
      expect(isValidBic('1NPAFRPP')).toBe(false);
    });
  });

  describe('SIREN / SIRET', () => {
    it('accepts valid numbers (Luhn)', () => {
      expect(isValidSirenOrSiret('443061841')).toBe(true);
      expect(isValidSirenOrSiret('443 061 841')).toBe(true);
      expect(isValidSirenOrSiret('44306184100047')).toBe(true);
    });
    it('rejects wrong checksums and lengths', () => {
      expect(isValidSirenOrSiret('443061842')).toBe(false);
      expect(isValidSirenOrSiret('44306184100048')).toBe(false);
      expect(isValidSirenOrSiret('12345678')).toBe(false);
      expect(isValidSirenOrSiret('ABCDEFGHI')).toBe(false);
    });
    it('handles the La Poste exception', () => {
      expect(isValidSirenOrSiret('35600000049837')).toBe(true);
    });
  });

  describe('French TIN (numéro fiscal)', () => {
    it('accepts 13 digits starting with 0 to 3', () => {
      expect(isValidFrenchTin('1234567890123')).toBe(true);
      expect(isValidFrenchTin('0 12 34 567 890 12')).toBe(true);
      expect(isValidFrenchTin('3999999999999')).toBe(true);
    });
    it('rejects other formats', () => {
      expect(isValidFrenchTin('4234567890123')).toBe(false);
      expect(isValidFrenchTin('123456789012')).toBe(false);
      expect(isValidFrenchTin('12345678901234')).toBe(false);
    });
  });

  describe('VAT number', () => {
    it('checks the key of French numbers', () => {
      expect(isValidVatNumber('FR64443061841')).toBe(true);
      expect(isValidVatNumber('FR 64 443 061 841')).toBe(true);
      expect(isValidVatNumber('FR65443061841')).toBe(false);
    });
    it('checks the format of other EU numbers', () => {
      expect(isValidVatNumber('DE123456789')).toBe(true);
      expect(isValidVatNumber('EL123456789')).toBe(true);
      expect(isValidVatNumber('DE1')).toBe(false);
    });
    it('is lenient with non-EU numbers', () => {
      expect(isValidVatNumber('CHE123456789')).toBe(true);
    });
  });

  describe('field formats', () => {
    it('accepts a complete individual profile', () => {
      expect(validateTaxProfileFields(completeIndividual(), NOW)).toEqual({});
    });

    it('rejects minors', () => {
      const profile = { ...completeIndividual(), dateOfBirth: new Date('2010-01-01T00:00:00Z') };
      expect(validateTaxProfileFields(profile, NOW)).toEqual({ dateOfBirth: expect.stringContaining('18 ans') });
    });

    it('computes the age on the birthday', () => {
      expect(ageAt(new Date('2008-10-25T00:00:00Z'), NOW)).toBe(18);
      expect(ageAt(new Date('2008-10-26T00:00:00Z'), NOW)).toBe(17);
    });

    it('rejects invalid country codes', () => {
      const profile = { ...completeIndividual(), country: 'XX', tinCountry: 'France' };
      const errors = validateTaxProfileFields(profile, NOW);
      expect(Object.keys(errors).sort()).toEqual(['country', 'tinCountry']);
    });

    it('validates the French TIN only when issued by France', () => {
      const fr = { ...completeIndividual(), taxIdentificationNumber: '99999' };
      expect(validateTaxProfileFields(fr, NOW)).toHaveProperty('taxIdentificationNumber');
      const de = { ...fr, tinCountry: 'DE', taxIdentificationNumber: '86095742719' };
      expect(validateTaxProfileFields(de, NOW)).toEqual({});
    });

    it('validates the SIREN of French sellers', () => {
      const profile = { ...completeIndividual(), companyRegistrationNumber: '443061842' };
      expect(validateTaxProfileFields(profile, NOW)).toHaveProperty('companyRegistrationNumber');
      expect(validateTaxProfileFields({ ...profile, companyRegistrationNumber: '443061841' }, NOW)).toEqual({});
      // Foreign registration numbers are kept as typed
      expect(validateTaxProfileFields({ ...profile, country: 'DE', postalCode: '10115', companyRegistrationNumber: 'HRB 12345' }, NOW)).toEqual({});
    });

    it('validates French postal codes', () => {
      expect(validateTaxProfileFields({ ...completeIndividual(), postalCode: '7500' }, NOW)).toHaveProperty('postalCode');
    });
  });

  describe('completeness', () => {
    it('a complete individual profile misses nothing', () => {
      expect(computeMissingFields(completeIndividual())).toEqual([]);
    });

    it('requires the TIN, or the place of birth when no TIN is issued', () => {
      const noTin = { ...completeIndividual(), taxIdentificationNumber: null, tinCountry: null };
      expect(computeMissingFields(noTin)).toEqual(['taxIdentificationNumber']);
      expect(computeMissingFields({ ...noTin, tinNotIssued: true })).toEqual(['placeOfBirth']);
      expect(computeMissingFields({ ...noTin, tinNotIssued: true, placeOfBirth: 'Lyon' })).toEqual([]);
    });

    it('requires the issuing country of the TIN', () => {
      expect(computeMissingFields({ ...completeIndividual(), tinCountry: null })).toEqual(['tinCountry']);
    });

    it('requires names, birth date, address, bank account and mandate', () => {
      const empty: TaxProfileFields = {
        entityType: 'individual',
        vatRegime: 'franchise',
        tinNotIssued: false,
        hasIban: false,
        selfBillingAccepted: false,
      };
      expect(computeMissingFields(empty)).toEqual([
        'firstName',
        'lastName',
        'dateOfBirth',
        'taxIdentificationNumber',
        'addressLine1',
        'postalCode',
        'city',
        'country',
        'accountHolderName',
        'iban',
        'selfBillingAccepted',
      ]);
    });

    it('companies need a name, a registration number and a TIN or VAT number', () => {
      const company: TaxProfileFields = {
        ...completeIndividual(),
        entityType: 'company',
        firstName: null,
        lastName: null,
        dateOfBirth: null,
        companyName: 'Studio Alice SAS',
        companyRegistrationNumber: '443061841',
        taxIdentificationNumber: null,
        tinCountry: null,
        vatNumber: null,
      };
      expect(computeMissingFields(company)).toEqual(['taxIdentificationNumber']);
      expect(computeMissingFields({ ...company, vatNumber: 'FR64443061841' })).toEqual([]);
      expect(computeMissingFields({ ...company, companyName: '' })).toEqual(['companyName', 'taxIdentificationNumber']);
    });

    it('sellers subject to VAT need a VAT number', () => {
      expect(computeMissingFields({ ...completeIndividual(), vatRegime: 'subject' })).toEqual(['vatNumber']);
    });
  });
});
