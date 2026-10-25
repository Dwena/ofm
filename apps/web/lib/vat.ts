import { formatEuros } from '@/lib/utils'

/**
 * VAT shown at checkout. Creators set prices excluding VAT; the VAT of the
 * fan's country is added on top. Same rates as the API
 * (apps/api/src/common/utils/vat.ts), which computes what is actually charged.
 */

export const EU_VAT_RATES: Readonly<Record<string, number>> = {
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 24, ES: 21, FI: 25.5,
  FR: 20, GR: 24, HR: 25, HU: 27, IE: 23, IT: 22, LT: 21, LU: 17, LV: 21, MT: 18,
  NL: 21, PL: 23, PT: 23, RO: 21, SE: 25, SI: 22, SK: 23,
}

/** Countries offered at checkout (EU first, then a few common ones) */
export const BILLING_COUNTRIES: { code: string; name: string }[] = [
  { code: 'FR', name: 'France' },
  { code: 'BE', name: 'Belgique' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MC', name: 'Monaco' },
  { code: 'DE', name: 'Allemagne' },
  { code: 'AT', name: 'Autriche' },
  { code: 'BG', name: 'Bulgarie' },
  { code: 'CY', name: 'Chypre' },
  { code: 'HR', name: 'Croatie' },
  { code: 'DK', name: 'Danemark' },
  { code: 'ES', name: 'Espagne' },
  { code: 'EE', name: 'Estonie' },
  { code: 'FI', name: 'Finlande' },
  { code: 'GR', name: 'Grèce' },
  { code: 'HU', name: 'Hongrie' },
  { code: 'IE', name: 'Irlande' },
  { code: 'IT', name: 'Italie' },
  { code: 'LV', name: 'Lettonie' },
  { code: 'LT', name: 'Lituanie' },
  { code: 'MT', name: 'Malte' },
  { code: 'NL', name: 'Pays-Bas' },
  { code: 'PL', name: 'Pologne' },
  { code: 'PT', name: 'Portugal' },
  { code: 'CZ', name: 'République tchèque' },
  { code: 'RO', name: 'Roumanie' },
  { code: 'SK', name: 'Slovaquie' },
  { code: 'SI', name: 'Slovénie' },
  { code: 'SE', name: 'Suède' },
  { code: 'CH', name: 'Suisse' },
  { code: 'GB', name: 'Royaume-Uni' },
  { code: 'CA', name: 'Canada' },
  { code: 'US', name: 'États-Unis' },
  { code: 'MA', name: 'Maroc' },
  { code: 'DZ', name: 'Algérie' },
  { code: 'TN', name: 'Tunisie' },
  { code: 'SN', name: 'Sénégal' },
  { code: 'CI', name: 'Côte d’Ivoire' },
]

export function vatRateForCountry(country: string | null | undefined): number {
  const code = country?.toUpperCase()
  if (!code) return 0
  return EU_VAT_RATES[code === 'MC' ? 'FR' : code] ?? 0
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** Price excluding VAT -> VAT and total charged to the fan */
export function priceWithVat(amount: number, country: string | null | undefined) {
  const vatRate = vatRateForCountry(country)
  const vatAmount = round((amount * vatRate) / 100)
  return { amount: round(amount), vatRate, vatAmount, totalAmount: round(amount + vatAmount) }
}

const STORAGE_KEY = 'billingCountry'

/** Billing country remembered on this device (the API keeps the account's one) */
export function getStoredBillingCountry(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeBillingCountry(country: string) {
  try {
    localStorage.setItem(STORAGE_KEY, country)
  } catch {
    // Private mode: the country is asked again next time
  }
}

/**
 * Price shown to fans: consumers must see prices including VAT. Uses the
 * billing country remembered on this device (France by default); the exact
 * total for the fan's country is shown at checkout.
 */
export function formatFanPrice(amount: number | string | null | undefined, country?: string | null): string {
  const value = Number(amount ?? 0)
  const { totalAmount } = priceWithVat(Number.isFinite(value) ? value : 0, country ?? getStoredBillingCountry() ?? 'FR')
  return `${formatEuros(totalAmount)} TTC`
}
