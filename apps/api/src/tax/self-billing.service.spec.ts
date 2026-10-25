import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { SelfBillingService } from './self-billing.service';
import { SaleRecord } from './tax-reports';

const sale = (type: string, amount: number): SaleRecord => ({
  type,
  amount,
  platformFee: amount * 0.15,
  netAmount: amount * 0.85,
  date: new Date('2026-09-10T12:00:00Z'),
});

function setup(options: { existing?: string[]; failCreateFor?: string } = {}) {
  let counter = 0;
  const invoices: any[] = [];
  const prisma: any = {
    selfBillingInvoice: {
      findMany: jest.fn(async () => (options.existing ?? []).map((creatorId) => ({ creatorId }))),
    },
    user: { findUnique: jest.fn(async ({ where }: any) => ({ displayName: null, username: where.id })) },
    creatorTaxProfile: { findUnique: jest.fn(async () => null) },
    legalAcceptance: { findFirst: jest.fn(async () => null) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  // Interactive transaction: the counter increment is rolled back when the invoice cannot be created
  prisma.$transaction = jest.fn(async (fn: any) => {
    const before = counter;
    const tx = {
      $queryRaw: jest.fn(async () => [{ value: ++counter }]),
      selfBillingInvoice: {
        create: jest.fn(async ({ data }: any) => {
          if (data.creatorId === options.failCreateFor) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
          }
          invoices.push(data);
          return data;
        }),
      },
    };
    try {
      return await fn(tx);
    } catch (error) {
      counter = before;
      throw error;
    }
  });
  const config: any = { get: jest.fn((key: string, fallback: string) => ({ COMPANY_NAME: 'FanVIP SAS', COMPANY_SIREN: '443061841' } as any)[key] ?? fallback) };
  const data: any = {
    loadSales: jest.fn(async () => new Map([
      ['creator-a', [sale('SUBSCRIPTION', 10)]],
      ['creator-b', [sale('TIP', 20)]],
      ['creator-c', [sale('PPV_UNLOCK', 5)]],
    ])),
    loadAdjustments: jest.fn(async () => new Map()),
  };
  return { service: new SelfBillingService(prisma, config, data), prisma, invoices };
}

describe('SelfBillingService', () => {
  const now = new Date('2026-10-01T05:10:00Z');

  it('numbers the invoices sequentially, without gaps, and skips creators already invoiced', async () => {
    const { service, invoices, prisma } = setup({ existing: ['creator-b'] });
    const result = await service.generateForMonth(2026, 9, 'admin-1', now);

    expect(result).toMatchObject({ period: '2026-09', created: 2, skipped: 1, failed: 0 });
    expect(invoices.map((i) => [i.creatorId, i.number])).toEqual([
      ['creator-a', expect.stringMatching(/^AF-\d{4}-000001$/)],
      ['creator-c', expect.stringMatching(/^AF-\d{4}-000002$/)],
    ]);
    expect(invoices[0]).toMatchObject({
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
      salesAmount: 10,
      platformFee: 1.5,
      netAmount: 8.5,
      vatRate: 0,
      totalAmount: 8.5,
    });
    expect(invoices[0].data.buyer).toMatchObject({ name: 'FanVIP SAS', siren: '443061841' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'admin-1', action: 'SELF_BILLING_INVOICES_GENERATED' }),
    });
  });

  it('a concurrent duplicate is skipped and its number reused by the next invoice', async () => {
    const { service, invoices } = setup({ failCreateFor: 'creator-a' });
    const result = await service.generateForMonth(2026, 9, undefined, now);
    expect(result).toMatchObject({ created: 2, skipped: 1, failed: 0 });
    expect(invoices.map((i) => i.number.slice(-6))).toEqual(['000001', '000002']);
  });

  it('refuses a month that is not over', async () => {
    const { service } = setup();
    await expect(service.generateForMonth(2026, 10, undefined, now)).rejects.toBeInstanceOf(BadRequestException);
  });
});
