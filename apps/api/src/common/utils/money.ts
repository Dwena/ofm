import { Prisma } from '@prisma/client';

/**
 * Money conventions
 *
 * - The database stores amounts in EUROS (`Decimal(10,2)` / `Decimal(12,2)`).
 * - Payment providers receive and send euros (see payments/providers).
 * - The REST API always returns euros as plain numbers.
 * - Fan payments: `amount` excludes VAT, `totalAmount` is what the fan paid
 *   (see common/utils/vat.ts).
 */

/** Round a euro amount to the cent */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Euros -> cents */
export function toCents(euros: number | Prisma.Decimal): number {
  return Math.round(Number(euros) * 100);
}

/** Cents -> euros */
export function fromCents(cents: number): number {
  return roundMoney(cents / 100);
}

/** Platform fee and creator net amount (euros) for a gross euro amount */
export function computeFees(amount: number, feePercentage: number) {
  const platformFee = roundMoney((amount * feePercentage) / 100);
  return { platformFee, netAmount: roundMoney(amount - platformFee) };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Recursively replace Prisma Decimal values by numbers, so money is serialized
 * as `12.5` instead of the string `"12.5"`. Other values are left untouched.
 */
export function serializeDecimals<T>(value: T, depth = 0): T {
  if (depth > 32 || value === null || value === undefined) return value;

  if (Prisma.Decimal.isDecimal(value)) {
    return (value as unknown as Prisma.Decimal).toNumber() as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeDecimals(item, depth + 1)) as unknown as T;
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = serializeDecimals(item, depth + 1);
    }
    return result as T;
  }

  return value;
}
