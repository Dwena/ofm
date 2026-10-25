import { Prisma } from '@prisma/client';
import { computeFees, fromCents, roundMoney, serializeDecimals, toCents } from './money';

describe('money helpers', () => {
  it('converts euros to Stripe cents without float drift', () => {
    expect(toCents(9.99)).toBe(999);
    expect(toCents(19.9)).toBe(1990);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(new Prisma.Decimal('12.34'))).toBe(1234);
  });

  it('converts Stripe cents to euros', () => {
    expect(fromCents(999)).toBe(9.99);
    expect(fromCents(5000)).toBe(50);
    expect(fromCents(0)).toBe(0);
  });

  it('rounds to the cent', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(8.4999)).toBe(8.5);
  });

  it('splits platform fee and creator net amount in euros', () => {
    expect(computeFees(10, 15)).toEqual({ platformFee: 1.5, netAmount: 8.5 });
    expect(computeFees(9.99, 15)).toEqual({ platformFee: 1.5, netAmount: 8.49 });
  });

  it('serializes Prisma Decimals as numbers, deeply', () => {
    const date = new Date('2026-10-19T00:00:00Z');
    const result = serializeDecimals({
      price: new Prisma.Decimal('9.99'),
      nested: { items: [{ amount: new Prisma.Decimal('10.50'), label: 'a' }] },
      empty: null,
      date,
    });

    expect(result).toEqual({
      price: 9.99,
      nested: { items: [{ amount: 10.5, label: 'a' }] },
      empty: null,
      date,
    });
    expect(result.date).toBe(date);
    expect(serializeDecimals(new Prisma.Decimal('1.20'))).toBe(1.2);
    expect(serializeDecimals('12.5')).toBe('12.5');
  });
});
