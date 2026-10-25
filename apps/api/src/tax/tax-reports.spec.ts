import {
  AdjustmentRecord,
  MENTION_FRANCHISE,
  MENTION_REVERSE_CHARGE,
  SaleRecord,
  aggregateByQuarter,
  computeInvoiceLines,
  computeInvoiceVat,
  monthRange,
  previousMonth,
  splitAdjustment,
} from './tax-reports';
import { buildInvoice, creatorIdentity } from './self-billing.service';
import { buildDac7Record, dac7ToCsv } from './tax-statements.service';
import { formatInvoiceNumber } from './tax.constants';
import { isReminderDue } from './tax-reminder.service';

const sale = (type: string, amount: number, date = '2026-09-10', feePct = 15): SaleRecord => {
  const platformFee = Math.round(amount * feePct) / 100;
  return { type, amount, platformFee, netAmount: Math.round((amount - platformFee) * 100) / 100, date: new Date(`${date}T12:00:00Z`) };
};

const refundOf = (original: SaleRecord, share = original.netAmount, date = '2026-09-20', type: AdjustmentRecord['type'] = 'REFUND'): AdjustmentRecord => ({
  type,
  amount: type === 'CHARGEBACK_REVERSAL' ? share : -share,
  date: new Date(`${date}T12:00:00Z`),
  original: { type: original.type, amount: original.amount, platformFee: original.platformFee, netAmount: original.netAmount },
});

describe('tax reports', () => {
  describe('splitAdjustment', () => {
    it('splits a full refund like the original sale', () => {
      const original = sale('SUBSCRIPTION', 24.99); // fee 3.75, net 21.24
      expect(splitAdjustment(refundOf(original))).toEqual({ salesAmount: -24.99, platformFee: -3.75, netAmount: -21.24 });
    });

    it('splits a partial refund proportionally', () => {
      const original = sale('TIP', 20); // fee 3, net 17
      expect(splitAdjustment(refundOf(original, 8.5))).toEqual({ salesAmount: -10, platformFee: -1.5, netAmount: -8.5 });
    });

    it('is positive for a chargeback reversal', () => {
      const original = sale('TIP', 20);
      expect(splitAdjustment(refundOf(original, 17, '2026-09-20', 'CHARGEBACK_REVERSAL'))).toEqual({
        salesAmount: 20,
        platformFee: 3,
        netAmount: 17,
      });
    });

    it('falls back to the share when the sale is unknown', () => {
      expect(splitAdjustment({ amount: -5, original: null })).toEqual({ salesAmount: -5, platformFee: 0, netAmount: -5 });
    });
  });

  describe('invoice lines', () => {
    it('groups sales by type and adds credit lines', () => {
      const sub1 = sale('SUBSCRIPTION', 9.99);
      const sub2 = sale('SUBSCRIPTION', 24.99);
      const tip = sale('TIP', 10);
      const ppv = sale('PPV_UNLOCK', 5);
      const result = computeInvoiceLines([tip, sub1, ppv, sub2], [refundOf(sub2)]);

      expect(result.lines.map((l) => [l.type, l.kind, l.count])).toEqual([
        ['SUBSCRIPTION', 'SALE', 2],
        ['TIP', 'SALE', 1],
        ['PPV_UNLOCK', 'SALE', 1],
        ['REFUND', 'CREDIT', 1],
      ]);
      expect(result.lines[0]).toMatchObject({ salesAmount: 34.98, platformFee: 5.25, netAmount: 29.73 });
      expect(result.lines[3]).toMatchObject({ salesAmount: -24.99, platformFee: -3.75, netAmount: -21.24 });
      // 9.99 + 10 + 5 remain: fee 1.50 + 1.50 + 0.75
      expect(result).toMatchObject({ salesAmount: 24.99, platformFee: 3.75, netAmount: 21.24 });
      expect(Math.round((result.salesAmount - result.platformFee) * 100) / 100).toBe(result.netAmount);
    });

    it('nets to a negative amount when refunds exceed the sales (credit note)', () => {
      const old = sale('SUBSCRIPTION', 50, '2026-08-01');
      const result = computeInvoiceLines([sale('TIP', 10)], [refundOf(old, old.netAmount, '2026-09-02', 'CHARGEBACK')]);
      expect(result.netAmount).toBe(-34);
      expect(result.lines[1]).toMatchObject({ type: 'CHARGEBACK', label: expect.stringContaining('Contestations') });
    });

    it('sums without floating point drift', () => {
      const sales = Array.from({ length: 1000 }, () => sale('TIP', 0.1, '2026-09-10', 0));
      expect(computeInvoiceLines(sales, []).salesAmount).toBe(100);
    });
  });

  describe('invoice VAT', () => {
    it('franchise regime: no VAT, art. 293 B mention', () => {
      expect(computeInvoiceVat(100, { country: 'FR', vatRegime: 'franchise', vatNumber: null })).toEqual({
        vatRate: 0,
        vatAmount: 0,
        mention: MENTION_FRANCHISE,
        reverseCharge: false,
        reviewRequired: false,
      });
    });

    it('French seller subject to VAT: 20 % on the creator share', () => {
      expect(computeInvoiceVat(85.55, { country: 'FR', vatRegime: 'subject', vatNumber: 'FR64443061841' })).toMatchObject({
        vatRate: 20,
        vatAmount: 17.11,
        mention: null,
      });
    });

    it('EU seller with a VAT number: reverse charge', () => {
      expect(computeInvoiceVat(100, { country: 'BE', vatRegime: 'subject', vatNumber: 'BE0123456789' })).toEqual({
        vatRate: 0,
        vatAmount: 0,
        mention: MENTION_REVERSE_CHARGE,
        reverseCharge: true,
        reviewRequired: false,
      });
    });

    it('other cross-border cases are flagged for the accountant', () => {
      expect(computeInvoiceVat(100, { country: 'BE', vatRegime: 'franchise', vatNumber: null })).toMatchObject({
        mention: MENTION_REVERSE_CHARGE,
        reviewRequired: true,
      });
      expect(computeInvoiceVat(100, { country: 'CH', vatRegime: 'subject', vatNumber: 'CHE123456789' })).toMatchObject({
        reviewRequired: true,
      });
    });
  });

  describe('buildInvoice', () => {
    const platform = { name: 'FanVIP SAS', address: '1 rue de Rivoli, 75001 Paris', siren: '443061841', vatNumber: 'FR64443061841' };
    const { start, end } = monthRange(2026, 9);

    it('snapshots both parties, the mentions and the totals', () => {
      const profile = {
        entityType: 'individual',
        firstName: 'Alice',
        lastName: 'Martin',
        addressLine1: '12 rue de la Paix',
        addressLine2: null,
        postalCode: '75002',
        city: 'Paris',
        country: 'FR',
        vatRegime: 'subject',
        vatNumber: 'FR64443061841',
        companyName: null,
        companyRegistrationNumber: '443061841',
        completedAt: new Date(),
      } as any;
      const invoice = buildInvoice({
        periodStart: start,
        periodEnd: end,
        issuedAt: new Date('2026-10-01T05:10:00Z'),
        number: formatInvoiceNumber(2026, 42),
        sales: [sale('SUBSCRIPTION', 100)],
        adjustments: [],
        creator: creatorIdentity(profile, { displayName: 'Alice', username: 'alice' }),
        platform,
        mandate: { acceptedAt: new Date('2026-09-01T00:00:00Z'), version: '2026-10-25' },
      });

      expect(invoice.totals).toEqual({ salesAmount: 100, platformFee: 15, netAmount: 85, vatRate: 20, vatAmount: 17, totalAmount: 102 });
      expect(invoice.data.number).toBe('AF-2026-000042');
      expect(invoice.data.documentType).toBe('invoice');
      expect(invoice.data.period).toEqual({ start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T23:59:59.999Z', label: 'septembre 2026' });
      expect(invoice.data.seller).toMatchObject({ name: 'Alice Martin', address: ['12 rue de la Paix', '75002 Paris', 'FR'] });
      expect(invoice.data.buyer).toEqual(platform);
      expect(invoice.data.mentions[0]).toBe('Autofacturation');
      expect(invoice.data.mentions[1]).toContain('au nom et pour le compte de Alice Martin');
    });

    it('issues a credit note with the franchise mention', () => {
      const old = sale('SUBSCRIPTION', 50, '2026-08-01');
      const invoice = buildInvoice({
        periodStart: start,
        periodEnd: end,
        issuedAt: new Date(),
        number: 'AF-2026-000001',
        sales: [],
        adjustments: [refundOf(old)],
        creator: creatorIdentity(null, { displayName: null, username: 'bob' }),
        platform,
        mandate: { acceptedAt: null, version: null },
      });
      expect(invoice.data.documentType).toBe('credit_note');
      expect(invoice.totals.totalAmount).toBe(-42.5);
      expect(invoice.data.seller.name).toBe('bob');
      expect(invoice.data.mentions).toContain(MENTION_FRANCHISE);
    });
  });

  describe('numbering', () => {
    it('formats AF-YYYY-NNNNNN', () => {
      expect(formatInvoiceNumber(2026, 1)).toBe('AF-2026-000001');
      expect(formatInvoiceNumber(2027, 123456)).toBe('AF-2027-123456');
    });

    it('previous month wraps around the year', () => {
      expect(previousMonth(new Date('2027-01-01T05:10:00Z'))).toEqual({ year: 2026, month: 12 });
      expect(previousMonth(new Date('2026-10-01T05:10:00Z'))).toEqual({ year: 2026, month: 9 });
    });
  });

  describe('quarterly aggregation (annual statement / DAC7)', () => {
    const sales = [
      sale('SUBSCRIPTION', 10, '2026-01-15'),
      sale('TIP', 20, '2026-03-31'),
      sale('PPV_UNLOCK', 5, '2026-04-01'),
      sale('SUBSCRIPTION', 10, '2026-12-31'),
    ];
    const adjustments = [refundOf(sales[1], 17, '2026-04-02')];

    it('splits by quarter of payment and sums the year', () => {
      const totals = aggregateByQuarter(sales, adjustments);
      expect(totals.quarters.map((q) => q.transactions)).toEqual([2, 1, 0, 1]);
      expect(totals.quarters[0]).toMatchObject({ salesAmount: 30, platformFee: 4.5, consideration: 25.5, refunds: 0 });
      expect(totals.quarters[1]).toMatchObject({ consideration: 4.25, refunds: 1, refundedAmount: 17, netConsideration: -12.75 });
      expect(totals.year).toEqual({
        transactions: 4,
        salesAmount: 45,
        platformFee: 6.75,
        consideration: 38.25,
        refunds: 1,
        refundedAmount: 17,
        netConsideration: 21.25,
      });
    });

    it('builds the DAC7 record and flags incomplete profiles', () => {
      const totals = aggregateByQuarter(sales, adjustments);
      const record = buildDac7Record({
        user: { id: 'c1', username: 'alice', email: 'alice@example.com' },
        profile: null,
        mandateAccepted: false,
        iban: null,
        totals,
      });
      expect(record.quarters).toEqual([
        { quarter: 1, consideration: 25.5, activities: 2, fees: 4.5, refunded: 0 },
        { quarter: 2, consideration: 4.25, activities: 1, fees: 0.75, refunded: 17 },
        { quarter: 3, consideration: 0, activities: 0, fees: 0, refunded: 0 },
        { quarter: 4, consideration: 8.5, activities: 1, fees: 1.5, refunded: 0 },
      ]);
      expect(record.total).toEqual({ consideration: 38.25, activities: 4, fees: 6.75, refunded: 17 });
      expect(record.profileComplete).toBe(false);
      expect(record.missingFields).toEqual(['profile']);
    });

    it('exports a ; separated CSV safe for spreadsheets', () => {
      const record = buildDac7Record({
        user: { id: 'c1', username: '=HYPERLINK("x")', email: 'a@b.c' },
        profile: { entityType: 'individual', firstName: 'Zoé', lastName: 'O"Neil', tinNotIssued: false, vatRegime: 'franchise' } as any,
        mandateAccepted: false,
        iban: 'FR7630006000011234567890189',
        totals: aggregateByQuarter(sales, []),
      });
      const csv = dac7ToCsv([record]);
      const [header, row] = csv.replace('﻿', '').trim().split('\r\n');
      expect(header.split(';')).toHaveLength(row.split(';').length);
      expect(row).toContain(`"'=HYPERLINK(""x"")"`);
      expect(row).toContain('"O""Neil"');
      expect(row).toContain('"FR7630006000011234567890189"');
      expect(row).toContain('25,50');
    });
  });

  describe('DAC7 reminders', () => {
    const now = new Date('2026-10-25T10:20:00Z');
    it('sends the first reminder right away, then every 30 days, at most twice', () => {
      expect(isReminderDue(null, now)).toBe(true);
      expect(isReminderDue({ reminderCount: 0, lastReminderAt: null }, now)).toBe(true);
      expect(isReminderDue({ reminderCount: 1, lastReminderAt: new Date('2026-10-01T10:20:00Z') }, now)).toBe(false);
      expect(isReminderDue({ reminderCount: 1, lastReminderAt: new Date('2026-09-25T10:20:00Z') }, now)).toBe(true);
      expect(isReminderDue({ reminderCount: 2, lastReminderAt: new Date('2026-01-01T00:00:00Z') }, now)).toBe(false);
    });
  });
});
