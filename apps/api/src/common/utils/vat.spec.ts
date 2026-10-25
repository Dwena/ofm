import { computeCharge, EU_VAT_RATES, normalizeCountry, vatRateForCountry } from './vat';

describe('VAT helpers', () => {
  it('adds the French VAT on top of the creator price, fee and creator share on the price excl. VAT', () => {
    expect(computeCharge(10, 15, 'FR')).toEqual({
      amount: 10,
      platformFee: 1.5,
      netAmount: 8.5,
      vatRate: 20,
      vatAmount: 2,
      totalAmount: 12,
      taxCountry: 'FR',
    });
  });

  it('applies the rate of the fan country (Germany 19 %)', () => {
    const charge = computeCharge(9.99, 15, 'de');

    expect(charge).toEqual(
      expect.objectContaining({ vatRate: 19, vatAmount: 1.9, totalAmount: 11.89, taxCountry: 'DE' }),
    );
    // The VAT does not change the creator share
    expect(charge.platformFee).toBe(1.5);
    expect(charge.netAmount).toBe(8.49);
  });

  it('charges no VAT outside the EU', () => {
    const charge = computeCharge(10, 15, 'US');

    expect(charge).toEqual(expect.objectContaining({ vatRate: 0, vatAmount: 0, totalAmount: 10, taxCountry: 'US' }));
    expect(charge.netAmount).toBe(8.5);
    expect(vatRateForCountry('CH')).toBe(0);
    expect(vatRateForCountry('GB')).toBe(0);
  });

  it('treats Monaco as part of the French VAT territory', () => {
    expect(vatRateForCountry('MC')).toBe(EU_VAT_RATES.FR);
    expect(computeCharge(10, 15, 'MC')).toEqual(expect.objectContaining({ vatRate: 20, totalAmount: 12, taxCountry: 'MC' }));
  });

  it('ignores a malformed or missing country (no VAT, no tax country)', () => {
    for (const country of ['FRA', 'F', '12', '', '  ', null, undefined]) {
      expect(normalizeCountry(country)).toBeNull();
      expect(vatRateForCountry(country)).toBe(0);
      expect(computeCharge(10, 15, country)).toEqual(expect.objectContaining({ vatRate: 0, totalAmount: 10, taxCountry: null }));
    }
  });

  it('normalizes the country code', () => {
    expect(normalizeCountry(' fr ')).toBe('FR');
    expect(vatRateForCountry(' fi ')).toBe(25.5);
  });

  it('rounds every part to the cent', () => {
    const charge = computeCharge(4.99, 20, 'HU');

    expect(charge.vatAmount).toBe(1.35);
    expect(charge.totalAmount).toBe(6.34);
    expect(charge.platformFee).toBe(1);
    expect(charge.netAmount).toBe(3.99);
  });
});
