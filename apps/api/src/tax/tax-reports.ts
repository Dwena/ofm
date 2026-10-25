import { roundMoney } from '../common/utils/money';
import { EU_COUNTRIES } from './tax-validation';

/**
 * Pure computations of the tax documents: monthly self-billing invoices,
 * annual statements of the creators (art. 242 bis CGI) and the DAC7 report.
 * Amounts are euros; sums are done in cents to avoid floating point drift.
 */

/** A paid sale of a creator (Transaction SUBSCRIPTION / TIP / PPV_UNLOCK) */
export interface SaleRecord {
  type: string;
  /** Price excluding VAT */
  amount: number;
  platformFee: number;
  /** Creator share */
  netAmount: number;
  /** Payment date */
  date: Date;
}

export type AdjustmentType = 'REFUND' | 'CHARGEBACK' | 'CHARGEBACK_REVERSAL';

/** A ledger entry taking back (or giving back) the creator share of a sale */
export interface AdjustmentRecord {
  type: AdjustmentType;
  /** Signed ledger amount: negative for REFUND / CHARGEBACK, positive for a reversal */
  amount: number;
  date: Date;
  /** The sale it relates to (CreatorBalanceEntry.transactionId) */
  original: { type: string; amount: number; platformFee: number; netAmount: number } | null;
}

export interface Amounts {
  salesAmount: number;
  platformFee: number;
  netAmount: number;
}

const cents = (euros: number) => Math.round(euros * 100);
const euros = (value: number) => roundMoney(value / 100);

/**
 * Split a ledger adjustment (creator share only) into price excl. VAT, fee and
 * creator share, proportionally to the original sale. Signed like the entry.
 */
export function splitAdjustment(adjustment: Pick<AdjustmentRecord, 'amount' | 'original'>): Amounts {
  const netAmount = roundMoney(adjustment.amount);
  const original = adjustment.original;
  if (!original || !(original.netAmount > 0)) {
    return { salesAmount: netAmount, platformFee: 0, netAmount };
  }
  const ratio = Math.abs(netAmount) / original.netAmount;
  const sign = netAmount < 0 ? -1 : 1;
  const salesAmount = sign * roundMoney(original.amount * ratio);
  return { salesAmount, platformFee: roundMoney(salesAmount - netAmount), netAmount };
}

// ==================== Self-billing invoices ====================

export const LINE_LABELS: Record<string, string> = {
  SUBSCRIPTION: 'Abonnements',
  TIP: 'Pourboires',
  PPV_UNLOCK: 'Contenus à l’unité (PPV)',
  REFUND: 'Remboursements accordés aux fans',
  CHARGEBACK: 'Contestations bancaires (chargebacks)',
  CHARGEBACK_REVERSAL: 'Contestations bancaires gagnées',
};

const LINE_ORDER = ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK', 'REFUND', 'CHARGEBACK', 'CHARGEBACK_REVERSAL'];

export interface InvoiceLine extends Amounts {
  /** SALE: sales of the month; CREDIT: share taken back (or given back for a reversal) */
  kind: 'SALE' | 'CREDIT';
  type: string;
  label: string;
  count: number;
}

export interface InvoiceComputation extends Amounts {
  lines: InvoiceLine[];
}

/**
 * Lines of a monthly invoice: one per sale type, then one credit line per kind
 * of adjustment. The creator invoices its share (netAmount); the price paid by
 * the fans and the platform fee are shown for information.
 */
export function computeInvoiceLines(sales: SaleRecord[], adjustments: AdjustmentRecord[]): InvoiceComputation {
  const buckets = new Map<string, { kind: InvoiceLine['kind']; count: number; s: number; f: number; n: number }>();
  const bucket = (type: string, kind: InvoiceLine['kind']) => {
    let entry = buckets.get(type);
    if (!entry) {
      entry = { kind, count: 0, s: 0, f: 0, n: 0 };
      buckets.set(type, entry);
    }
    return entry;
  };

  for (const sale of sales) {
    const entry = bucket(sale.type, 'SALE');
    entry.count++;
    entry.s += cents(sale.amount);
    entry.f += cents(sale.platformFee);
    entry.n += cents(sale.netAmount);
  }
  for (const adjustment of adjustments) {
    const split = splitAdjustment(adjustment);
    const entry = bucket(adjustment.type, 'CREDIT');
    entry.count++;
    entry.s += cents(split.salesAmount);
    entry.f += cents(split.platformFee);
    entry.n += cents(split.netAmount);
  }

  const order = (type: string) => {
    const index = LINE_ORDER.indexOf(type);
    return index === -1 ? LINE_ORDER.length : index;
  };
  const lines: InvoiceLine[] = [...buckets.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([type, entry]) => ({
      kind: entry.kind,
      type,
      label: LINE_LABELS[type] ?? type,
      count: entry.count,
      salesAmount: euros(entry.s),
      platformFee: euros(entry.f),
      netAmount: euros(entry.n),
    }));

  const total = (key: keyof Amounts) => euros(lines.reduce((sum, line) => sum + cents(line[key]), 0));
  return { lines, salesAmount: total('salesAmount'), platformFee: total('platformFee'), netAmount: total('netAmount') };
}

export interface CreatorVatSituation {
  country: string | null | undefined;
  vatRegime: string | null | undefined;
  vatNumber: string | null | undefined;
}

export interface InvoiceVat {
  vatRate: number;
  vatAmount: number;
  /** Mandatory mention on the invoice, if any */
  mention: string | null;
  /** The platform self-assesses the VAT (reverse charge) */
  reverseCharge: boolean;
  /** Case the accountant must confirm before the invoice is relied on */
  reviewRequired: boolean;
}

export const FRENCH_VAT_RATE = 20;
export const MENTION_FRANCHISE = 'TVA non applicable, art. 293 B du CGI';
export const MENTION_REVERSE_CHARGE = 'Autoliquidation';

/**
 * VAT on the creator's invoice (the creator supplies a service to the platform,
 * a French business: place of supply in France, art. 259-1 CGI).
 *
 * - creator in France under the franchise regime: no VAT, art. 293 B mention;
 * - creator in France subject to VAT: 20 % on the creator share;
 * - creator established outside France: the platform self-assesses the French
 *   VAT (reverse charge, art. 283-2 CGI / art. 196 of directive 2006/112/EC),
 *   invoice without VAT and mention "Autoliquidation". Implemented for EU
 *   creators with a VAT number; other cross-border cases (no VAT number,
 *   non-EU creators) get the same treatment but are flagged: they must be
 *   validated by the accountant.
 */
export function computeInvoiceVat(netAmount: number, creator: CreatorVatSituation): InvoiceVat {
  const country = (creator.country ?? '').toUpperCase();
  const domestic = country === 'FR' || country === 'MC' || country === '';

  if (domestic) {
    if (creator.vatRegime === 'subject') {
      return {
        vatRate: FRENCH_VAT_RATE,
        vatAmount: roundMoney((netAmount * FRENCH_VAT_RATE) / 100),
        mention: null,
        reverseCharge: false,
        reviewRequired: country === '',
      };
    }
    return { vatRate: 0, vatAmount: 0, mention: MENTION_FRANCHISE, reverseCharge: false, reviewRequired: country === '' };
  }

  const euWithVatNumber = EU_COUNTRIES.has(country) && !!creator.vatNumber?.trim();
  return {
    vatRate: 0,
    vatAmount: 0,
    mention: MENTION_REVERSE_CHARGE,
    reverseCharge: true,
    reviewRequired: !euWithVatNumber,
  };
}

// ==================== Quarterly aggregation (annual statement, DAC7) ====================

export interface PeriodTotals {
  /** Number of paid sales (DAC7 "number of relevant activities") */
  transactions: number;
  /** Prices paid by the fans, excluding VAT */
  salesAmount: number;
  /** Fees and commissions withheld by the platform */
  platformFee: number;
  /** Creator shares paid or credited (DAC7 "consideration": net of fees and taxes) */
  consideration: number;
  /** Number of refunds / chargebacks (net of reversals) */
  refunds: number;
  /** Creator shares taken back by refunds / chargebacks, net of reversals (positive) */
  refundedAmount: number;
  /** consideration - refundedAmount */
  netConsideration: number;
}

export interface QuarterlyTotals {
  /** Q1..Q4 */
  quarters: PeriodTotals[];
  year: PeriodTotals;
}

/** 0..3 (UTC) */
export const quarterOf = (date: Date) => Math.floor(date.getUTCMonth() / 3);

interface RawTotals {
  transactions: number;
  s: number;
  f: number;
  n: number;
  refunds: number;
  r: number;
}

const emptyRaw = (): RawTotals => ({ transactions: 0, s: 0, f: 0, n: 0, refunds: 0, r: 0 });

const toTotals = (raw: RawTotals): PeriodTotals => ({
  transactions: raw.transactions,
  salesAmount: euros(raw.s),
  platformFee: euros(raw.f),
  consideration: euros(raw.n),
  refunds: raw.refunds,
  refundedAmount: euros(raw.r),
  netConsideration: euros(raw.n - raw.r),
});

/**
 * Totals per quarter and for the year. Sales are attributed to the quarter
 * they were paid in, adjustments to the quarter they were booked in.
 */
export function aggregateByQuarter(sales: SaleRecord[], adjustments: AdjustmentRecord[]): QuarterlyTotals {
  const quarters = [emptyRaw(), emptyRaw(), emptyRaw(), emptyRaw()];
  for (const sale of sales) {
    const q = quarters[quarterOf(sale.date)];
    q.transactions++;
    q.s += cents(sale.amount);
    q.f += cents(sale.platformFee);
    q.n += cents(sale.netAmount);
  }
  for (const adjustment of adjustments) {
    const q = quarters[quarterOf(adjustment.date)];
    // Ledger amounts are negative when the share is taken back
    q.r -= cents(adjustment.amount);
    q.refunds += adjustment.type === 'CHARGEBACK_REVERSAL' ? -1 : 1;
  }
  const year = quarters.reduce((acc, q) => {
    acc.transactions += q.transactions;
    acc.s += q.s;
    acc.f += q.f;
    acc.n += q.n;
    acc.refunds += q.refunds;
    acc.r += q.r;
    return acc;
  }, emptyRaw());
  return { quarters: quarters.map(toTotals), year: toTotals(year) };
}

/** First instant of the month (UTC) and of the next one */
export function monthRange(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

export function yearRange(year: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

/** Month before `date` (UTC): { year, month 1-12 } */
export function previousMonth(date: Date): { year: number; month: number } {
  const month = date.getUTCMonth(); // 0-11: the previous month, 1-based
  return month === 0 ? { year: date.getUTCFullYear() - 1, month: 12 } : { year: date.getUTCFullYear(), month };
}
