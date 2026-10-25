import { BadRequestException, ForbiddenException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutsService } from './payouts.service';
import { CreatorBalanceService } from './creator-balance.service';

describe('PayoutsService', () => {
  let service: PayoutsService;
  let prisma: any;
  let taxProfiles: { isComplete: jest.Mock; getPayoutBankDetails: jest.Mock };
  let configValues: Record<string, string>;
  let user: any;
  let balances: Record<string, { available: number; pending: number }>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    user = { kycStatus: 'VERIFIED', status: 'ACTIVE' };
    balances = { 'creator-1': { available: 120, pending: 30 } };
    configValues = { PAYOUT_DEBTOR_NAME: 'FanVIP SAS', PAYOUT_DEBTOR_IBAN: 'FR7630006000011234567890189', COMPANY_NAME: 'FanVIP' };

    prisma = {
      user: { findUnique: jest.fn(async () => user), findMany: jest.fn() },
      creatorTaxProfile: { findUnique: jest.fn(async () => ({ ibanLast4: '0189' })) },
      creatorBalanceEntry: {
        create: jest.fn(async ({ data }: any) => data),
        aggregate: jest.fn(async ({ where }: any) => {
          const balance = balances[where.creatorId] ?? { available: 0, pending: 0 };
          return { _sum: { amount: new Prisma.Decimal(where.availableAt.lte ? balance.available : balance.pending) } };
        }),
      },
      payout: {
        create: jest.fn(async ({ data }: any) => ({ id: 'payout-1', ...data, amount: new Prisma.Decimal(data.amount) })),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(async ({ data }: any) => ({ id: 'payout-1', amount: new Prisma.Decimal('100'), ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      payoutBatch: { create: jest.fn(async ({ data }: any) => ({ id: 'batch-1', ...data, totalAmount: new Prisma.Decimal(data.totalAmount) })) },
      notification: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      $executeRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));

    taxProfiles = { isComplete: jest.fn(async () => true), getPayoutBankDetails: jest.fn() };

    service = new PayoutsService(
      prisma,
      new CreatorBalanceService(prisma),
      { getMinimumPayoutAmount: jest.fn(async () => 50) } as any,
      taxProfiles as any,
      { get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback) } as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const ledgerEntries = () => prisma.creatorBalanceEntry.create.mock.calls.map(([{ data }]: any) => data);

  describe('eligibility', () => {
    it('requires a verified identity, a complete tax profile and an active account', async () => {
      await expect(service.getEligibility('creator-1')).resolves.toEqual({ eligible: true, identityVerified: true, taxProfileComplete: true });

      user = { kycStatus: 'PENDING', status: 'ACTIVE' };
      await expect(service.getEligibility('creator-1')).resolves.toEqual({ eligible: false, identityVerified: false, taxProfileComplete: true });

      user = { kycStatus: 'VERIFIED', status: 'SUSPENDED' };
      await expect(service.getEligibility('creator-1')).resolves.toEqual(expect.objectContaining({ eligible: false }));

      user = { kycStatus: 'VERIFIED', status: 'ACTIVE' };
      taxProfiles.isComplete.mockResolvedValue(false);
      await expect(service.getEligibility('creator-1')).resolves.toEqual({ eligible: false, identityVerified: true, taxProfileComplete: false });
    });
  });

  describe('requestPayout', () => {
    it('is blocked without a verified identity', async () => {
      user = { kycStatus: 'PENDING', status: 'ACTIVE' };
      const error = await service.requestPayout('creator-1', 100).catch((e) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'IDENTITY_NOT_VERIFIED' }));
      expect(prisma.payout.create).not.toHaveBeenCalled();
    });

    it('is blocked without a complete tax profile', async () => {
      taxProfiles.isComplete.mockResolvedValue(false);
      const error = await service.requestPayout('creator-1', 100).catch((e) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'TAX_PROFILE_INCOMPLETE' }));
    });

    it('is blocked for a suspended account', async () => {
      user = { kycStatus: 'VERIFIED', status: 'SUSPENDED' };
      await expect(service.requestPayout('creator-1', 100)).rejects.toThrow(ForbiddenException);
    });

    it('enforces the minimum payout and the available balance (pending earnings excluded)', async () => {
      await expect(service.requestPayout('creator-1', 49.99)).rejects.toThrow('Le virement minimum est de 50.00€');
      await expect(service.requestPayout('creator-1', 120.01)).rejects.toThrow('Solde disponible insuffisant : 120.00€');

      balances['creator-1'] = { available: 40, pending: 500 };
      await expect(service.requestPayout('creator-1')).rejects.toThrow(BadRequestException);
      expect(prisma.payout.create).not.toHaveBeenCalled();
    });

    it('creates the payout and debits the balance under the creator lock', async () => {
      const { payout } = await service.requestPayout('creator-1', 100);

      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(prisma.payout.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ creatorId: 'creator-1', amount: 100, currency: 'EUR', status: 'PENDING', destination: '0189' }),
      });
      expect(ledgerEntries()).toEqual([
        expect.objectContaining({ creatorId: 'creator-1', type: 'PAYOUT', amount: -100, payoutId: 'payout-1' }),
      ]);
      expect(payout.amount).toBe(100);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'creator-1', message: expect.stringContaining('•••• 0189') }),
      });
    });

    it('pays the whole available balance when no amount is given', async () => {
      await service.requestPayout('creator-1');

      expect(ledgerEntries()).toEqual([expect.objectContaining({ type: 'PAYOUT', amount: -120 })]);
    });
  });

  it('weekly run pays out every eligible creator above the minimum', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'creator-1' }, { id: 'creator-2' }, { id: 'creator-3' }]);
    balances['creator-2'] = { available: 10, pending: 0 };
    balances['creator-3'] = { available: 80, pending: 0 };
    taxProfiles.isComplete.mockImplementation(async (id: string) => id !== 'creator-3');

    await expect(service.processAutomatedPayouts()).resolves.toEqual({ created: 1 });
    expect(prisma.payout.create).toHaveBeenCalledTimes(1);
    expect(prisma.payout.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ creatorId: 'creator-1', amount: 120 }));
  });

  describe('SEPA batch', () => {
    const pending = [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', creatorId: 'creator-1', amount: new Prisma.Decimal('100'), reference: null },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', creatorId: 'creator-2', amount: new Prisma.Decimal('55.5'), reference: null },
      { id: 'aaaaaaaa-0000-0000-0000-000000000003', creatorId: 'creator-3', amount: new Prisma.Decimal('70'), reference: null },
    ];

    beforeEach(() => {
      prisma.payout.findMany.mockResolvedValue(pending);
      taxProfiles.getPayoutBankDetails.mockImplementation(async (creatorId: string) =>
        creatorId === 'creator-3'
          ? null
          : { accountHolderName: creatorId === 'creator-1' ? 'Zoé Martin' : 'Bob', iban: 'FR76 1234 5678 9012 3456 7890 123', bic: null },
      );
    });

    it('moves the exportable payouts to PROCESSING and returns a valid pain.001 file', async () => {
      const result = await service.createBatch('admin-1');

      expect(prisma.payout.findMany).toHaveBeenCalledWith({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
      expect(prisma.payoutBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ createdBy: 'admin-1', totalAmount: 155.5, payoutCount: 2 }),
      });
      expect(prisma.payout.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.payout.updateMany).toHaveBeenCalledWith({
        where: { id: pending[0].id, status: 'PENDING' },
        data: expect.objectContaining({ status: 'PROCESSING', batchId: 'batch-1', reference: 'PO-AAAAAAAA0000000000000000' }),
      });

      expect(result.skipped).toEqual([{ payoutId: pending[2].id, reason: expect.any(String) }]);
      expect(result.fileName).toMatch(/^FV-\d{8}-[0-9A-F]{8}\.xml$/);
      expect(result.batch.totalAmount).toBe(155.5);
      expect(result.xml).toContain('<NbOfTxs>2</NbOfTxs>');
      expect(result.xml).toContain('<CtrlSum>155.50</CtrlSum>');
      expect(result.xml).toContain('<Nm>Zoe Martin</Nm>');
      expect(result.xml).toContain('<IBAN>FR7630006000011234567890189</IBAN>');
      expect(result.xml).toContain('<IBAN>FR7612345678901234567890123</IBAN>');
      expect(result.xml).toContain('<EndToEndId>PO-AAAAAAAA0000000000000000</EndToEndId>');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'admin-1', action: 'PAYOUT_BATCH_CREATED', resourceId: 'batch-1' }),
      });
    });

    it('exports only the chosen payouts', async () => {
      prisma.payout.findMany.mockResolvedValue([pending[0]]);

      await service.createBatch('admin-1', [pending[0].id]);

      expect(prisma.payout.findMany).toHaveBeenCalledWith({
        where: { status: 'PENDING', id: { in: [pending[0].id] } },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('refuses when no payout has bank details, or when none is pending', async () => {
      prisma.payout.findMany.mockResolvedValueOnce([pending[2]]).mockResolvedValueOnce([]);

      await expect(service.createBatch('admin-1')).rejects.toThrow('coordonnées bancaires manquantes');
      await expect(service.createBatch('admin-1')).rejects.toThrow('Aucun virement en attente');
      expect(prisma.payoutBatch.create).not.toHaveBeenCalled();
    });

    it('refuses without the platform bank account', async () => {
      configValues = {};

      await expect(service.createBatch('admin-1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('aborts when a payout changed during the export', async () => {
      prisma.payout.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      await expect(service.createBatch('admin-1')).rejects.toThrow(BadRequestException);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('paid / failed', () => {
    const payout = (status: string) => ({ id: 'payout-1', creatorId: 'creator-1', amount: new Prisma.Decimal('100'), currency: 'EUR', status });

    it('marks a transfer paid', async () => {
      prisma.payout.findUnique.mockResolvedValue(payout('PROCESSING'));

      await expect(service.markPaid('admin-1', 'payout-1')).resolves.toEqual(expect.objectContaining({ status: 'COMPLETED', amount: 100 }));
      expect(ledgerEntries()).toEqual([]);

      prisma.payout.findUnique.mockResolvedValue(payout('FAILED'));
      await expect(service.markPaid('admin-1', 'payout-1')).rejects.toThrow(BadRequestException);
    });

    it('a rejected transfer goes back to the balance', async () => {
      prisma.payout.findUnique.mockResolvedValue(payout('PROCESSING'));

      await service.markFailed('admin-1', 'payout-1', 'IBAN fermé');

      expect(prisma.payout.update).toHaveBeenCalledWith({
        where: { id: 'payout-1' },
        data: { status: 'FAILED', failedAt: expect.any(Date), failureReason: 'IBAN fermé' },
      });
      expect(ledgerEntries()).toEqual([
        expect.objectContaining({ creatorId: 'creator-1', type: 'PAYOUT_REVERSAL', amount: 100, payoutId: 'payout-1', description: 'Virement rejeté : IBAN fermé' }),
      ]);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PAYOUT_FAILED' }) });
    });

    it('cancels only a pending payout, and never reverses twice', async () => {
      prisma.payout.findUnique.mockResolvedValue(payout('PENDING'));
      await service.markFailed('admin-1', 'payout-1', 'Erreur', true);
      expect(prisma.payout.update.mock.calls[0][0].data).toEqual({ status: 'CANCELLED', failureReason: 'Erreur' });
      expect(ledgerEntries()).toHaveLength(1);

      prisma.payout.findUnique.mockResolvedValue(payout('PROCESSING'));
      await expect(service.markFailed('admin-1', 'payout-1', 'Erreur', true)).rejects.toThrow(BadRequestException);

      prisma.payout.findUnique.mockResolvedValue(payout('FAILED'));
      await expect(service.markFailed('admin-1', 'payout-1', 'Erreur')).rejects.toThrow(BadRequestException);

      prisma.payout.findUnique.mockResolvedValue(null);
      await expect(service.markFailed('admin-1', 'payout-1', 'Erreur')).rejects.toThrow(NotFoundException);
      expect(ledgerEntries()).toHaveLength(1);
    });
  });
});
