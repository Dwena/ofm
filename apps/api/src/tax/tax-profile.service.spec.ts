import { BadRequestException } from '@nestjs/common';
import { TaxProfileService } from './tax-profile.service';
import { SELF_BILLING_MANDATE_VERSION } from './tax.constants';
import { decryptValue, encryptValue } from '../common/utils/crypto';

process.env.DATA_ENCRYPTION_KEY = 'test-key-for-tax-profile-spec-0123456789';

const IBAN = 'FR7630006000011234567890189';

const completeForm = {
  entityType: 'individual' as const,
  firstName: 'Alice',
  lastName: 'Martin',
  dateOfBirth: '1995-04-12',
  vatRegime: 'franchise' as const,
  addressLine1: '12 rue de la Paix',
  postalCode: '75002',
  city: 'Paris',
  country: 'fr',
  taxIdentificationNumber: '1 23 45 678 901 23',
  tinCountry: 'FR',
  accountHolderName: 'Alice Martin',
  iban: 'FR76 3000 6000 0112 3456 7890 189',
  selfBillingAccepted: true,
};

function createPrisma(initial: any = null, acceptedVersion: string | null = null) {
  const state: { profile: any; acceptances: any[] } = {
    profile: initial,
    acceptances: acceptedVersion ? [{ version: acceptedVersion }] : [],
  };
  const prisma: any = {
    state,
    creatorTaxProfile: {
      findUnique: jest.fn(async () => state.profile),
      upsert: jest.fn(async ({ create, update }: any) => {
        state.profile = { id: 'tp1', createdAt: new Date(), ...(state.profile ?? create), ...(state.profile ? update : {}), updatedAt: new Date() };
        return state.profile;
      }),
    },
    legalAcceptance: {
      findFirst: jest.fn(async () => state.acceptances[state.acceptances.length - 1] ?? null),
      create: jest.fn(async ({ data }: any) => {
        state.acceptances.push(data);
        return data;
      }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
    notification: { create: jest.fn(async () => ({})) },
    user: { findUnique: jest.fn(async () => ({ email: 'alice@example.com', dateOfBirth: null, billingCountry: 'FR' })) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return prisma;
}

const mail = { sendMail: jest.fn(async () => true) };

describe('TaxProfileService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves a complete profile: encrypted IBAN, mandate acceptance, completedAt', async () => {
    const prisma = createPrisma();
    const service = new TaxProfileService(prisma, mail as any);

    const view = await service.updateProfile('u1', completeForm, { ipAddress: '203.0.113.7', userAgent: 'UA' });

    expect(view.status).toEqual({ complete: true, payoutsBlocked: false, missingFields: [] });
    const saved = prisma.state.profile;
    expect(saved.country).toBe('FR');
    expect(saved.taxIdentificationNumber).toBe('1234567890123');
    expect(saved.ibanLast4).toBe('0189');
    expect(saved.ibanEncrypted).not.toContain(IBAN);
    expect(decryptValue(saved.ibanEncrypted)).toBe(IBAN);
    expect(saved.completedAt).toBeInstanceOf(Date);
    expect(saved.dateOfBirth.toISOString()).toBe('1995-04-12T00:00:00.000Z');

    expect(prisma.legalAcceptance.create).toHaveBeenCalledWith({
      data: { userId: 'u1', document: 'self_billing', version: SELF_BILLING_MANDATE_VERSION, ipAddress: '203.0.113.7', userAgent: 'UA' },
    });
    // Never the IBAN in the response nor in the audit logs
    expect(JSON.stringify(view)).not.toContain(IBAN);
    expect(view.profile).toMatchObject({ hasIban: true, ibanLast4: '0189', selfBillingAccepted: true });
    const audits = prisma.auditLog.create.mock.calls.map((call: any) => call[0].data);
    expect(audits.map((a: any) => a.action)).toEqual(
      expect.arrayContaining(['TAX_PROFILE_UPDATED', 'SELF_BILLING_MANDATE_ACCEPTED', 'TAX_PROFILE_COMPLETED']),
    );
    expect(JSON.stringify(audits)).not.toContain(IBAN);
    expect(JSON.stringify(audits)).not.toContain('1234567890123');
    // First bank account: no "bank details changed" alert
    expect(prisma.notification.create).not.toHaveBeenCalled();

    expect(await service.isComplete('u1')).toBe(true);
    expect(await service.getPayoutBankDetails('u1')).toEqual({ accountHolderName: 'Alice Martin', iban: IBAN, bic: null });
  });

  it('rejects invalid values with field errors and saves nothing', async () => {
    const prisma = createPrisma();
    const service = new TaxProfileService(prisma, mail as any);
    const error = await service
      .updateProfile('u1', { ...completeForm, iban: 'FR7630006000011234567890188', taxIdentificationNumber: '999', dateOfBirth: '2012-01-01' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(Object.keys(error.getResponse().errors).sort()).toEqual(['dateOfBirth', 'iban', 'taxIdentificationNumber']);
    expect(prisma.creatorTaxProfile.upsert).not.toHaveBeenCalled();
  });

  it('requires a BIC for an IBAN outside the EEA', async () => {
    const service = new TaxProfileService(createPrisma(), mail as any);
    const error = await service.updateProfile('u1', { ...completeForm, iban: 'CH9300762011623852957' }).catch((e) => e);
    expect(error.getResponse().errors).toEqual({ bic: expect.any(String) });
  });

  it('keeps the saved IBAN when the field is left empty, and clears completedAt when the profile becomes incomplete', async () => {
    const prisma = createPrisma();
    const service = new TaxProfileService(prisma, mail as any);
    await service.updateProfile('u1', completeForm);
    const encrypted = prisma.state.profile.ibanEncrypted;

    const view = await service.updateProfile('u1', { ...completeForm, iban: '', city: '' });
    expect(prisma.state.profile.ibanEncrypted).toBe(encrypted);
    expect(prisma.state.profile.completedAt).toBeNull();
    expect(view.status).toEqual({ complete: false, payoutsBlocked: true, missingFields: ['city'] });
    expect(await service.isComplete('u1')).toBe(false);
  });

  it('alerts the creator when the payout account changes', async () => {
    const prisma = createPrisma();
    const service = new TaxProfileService(prisma, mail as any);
    await service.updateProfile('u1', completeForm);
    await service.updateProfile('u1', { iban: 'DE89370400440532013000' });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', type: 'SYSTEM', metadata: { kind: 'BANK_DETAILS_CHANGED' } }),
    });
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@example.com' }));
    expect(prisma.state.profile.ibanLast4).toBe('3000');
  });

  it('an older mandate version does not count as accepted', async () => {
    const profile = {
      id: 'tp1',
      userId: 'u1',
      entityType: 'individual',
      firstName: 'Alice',
      lastName: 'Martin',
      dateOfBirth: new Date('1995-04-12T00:00:00Z'),
      vatRegime: 'franchise',
      addressLine1: '12 rue de la Paix',
      postalCode: '75002',
      city: 'Paris',
      country: 'FR',
      taxIdentificationNumber: '1234567890123',
      tinCountry: 'FR',
      tinNotIssued: false,
      accountHolderName: 'Alice Martin',
      ibanEncrypted: encryptValue(IBAN),
      ibanLast4: '0189',
      selfBillingAcceptedAt: new Date('2025-01-01T00:00:00Z'),
      completedAt: new Date('2025-01-01T00:00:00Z'),
    };
    const service = new TaxProfileService(createPrisma(profile, '2000-01-01'), mail as any);
    expect(await service.isComplete('u1')).toBe(false);
    const view = await service.getProfile('u1');
    expect(view.status.missingFields).toEqual(['selfBillingAccepted']);
  });

  it('isComplete is false and bank details null without a profile', async () => {
    const service = new TaxProfileService(createPrisma(), mail as any);
    expect(await service.isComplete('u1')).toBe(false);
    expect(await service.getPayoutBankDetails('u1')).toBeNull();
    const view = await service.getProfile('u1');
    expect(view.exists).toBe(false);
    expect(view.profile.country).toBe('FR');
  });
});
