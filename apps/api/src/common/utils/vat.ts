import { roundMoney } from './money';

/**
 * VAT on fan payments
 *
 * Creators set their prices excluding VAT. The platform sells the electronic
 * service to the fan in its own name (art. 9a of Implementing Regulation
 * 282/2011), so it adds the VAT of the fan's country on top of the price and
 * pays it (One-Stop Shop return for other EU countries). The platform fee and
 * the creator share are computed on the price excluding VAT:
 *
 *   price 10.00 € (fan in France, 20 %) -> fan pays 12.00 €
 *   VAT 2.00 € (platform pays it), platform fee 1.50 €, creator 8.50 €
 *
 * Fans outside the EU are charged no VAT here. Several non-EU countries (UK,
 * Switzerland, Norway...) also tax digital services sold to their residents
 * above a turnover threshold: check with the accountant before selling there.
 */

/**
 * Standard VAT rates of the EU member states (percent), as of October 2026.
 * Rates change: review this table every year (and on any announced change).
 */
export const EU_VAT_RATES: Readonly<Record<string, number>> = {
  AT: 20,
  BE: 21,
  BG: 20,
  CY: 19,
  CZ: 21,
  DE: 19,
  DK: 25,
  EE: 24,
  ES: 21,
  FI: 25.5,
  FR: 20,
  GR: 24,
  HR: 25,
  HU: 27,
  IE: 23,
  IT: 22,
  LT: 21,
  LU: 17,
  LV: 21,
  MT: 18,
  NL: 21,
  PL: 23,
  PT: 23,
  RO: 21,
  SE: 25,
  SI: 22,
  SK: 23,
};

/** Monaco is part of the French VAT territory */
const VAT_TERRITORY_ALIASES: Readonly<Record<string, string>> = { MC: 'FR' };

/** ISO 3166-1 alpha-2 country code, upper-cased, or null when malformed */
export function normalizeCountry(country: string | null | undefined): string | null {
  const code = country?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

/** VAT rate (percent) charged to a fan located in this country */
export function vatRateForCountry(country: string | null | undefined): number {
  const code = normalizeCountry(country);
  if (!code) return 0;
  return EU_VAT_RATES[VAT_TERRITORY_ALIASES[code] ?? code] ?? 0;
}

export interface ChargeBreakdown {
  /** Price excluding VAT, set by the creator (euros) */
  amount: number;
  /** Platform fee, on the price excluding VAT (euros) */
  platformFee: number;
  /** Creator share (euros) */
  netAmount: number;
  /** VAT rate (percent) */
  vatRate: number;
  /** VAT added on top of the price (euros) */
  vatAmount: number;
  /** What the fan pays (euros) */
  totalAmount: number;
  /** Country the VAT is charged for (null outside the EU / unknown) */
  taxCountry: string | null;
}

/**
 * Split of a fan payment: VAT on top of the creator price, platform fee and
 * creator share on the price excluding VAT
 */
export function computeCharge(
  price: number,
  feePercentage: number,
  country: string | null | undefined,
): ChargeBreakdown {
  const amount = roundMoney(price);
  const platformFee = roundMoney((amount * feePercentage) / 100);
  const vatRate = vatRateForCountry(country);
  const vatAmount = roundMoney((amount * vatRate) / 100);

  return {
    amount,
    platformFee,
    netAmount: roundMoney(amount - platformFee),
    vatRate,
    vatAmount,
    totalAmount: roundMoney(amount + vatAmount),
    taxCountry: normalizeCountry(country),
  };
}
