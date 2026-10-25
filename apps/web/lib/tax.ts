import { api } from '@/lib/api'

/**
 * Tax compliance of creators: tax profile (DAC7), self-billing invoices,
 * annual statements, and the back-office DAC7 export. API: apps/api/src/tax.
 */

export type EntityType = 'individual' | 'company'
export type VatRegime = 'franchise' | 'subject'

export interface TaxProfile {
  entityType: EntityType
  firstName: string | null
  lastName: string | null
  /** YYYY-MM-DD */
  dateOfBirth: string | null
  placeOfBirth: string | null
  companyName: string | null
  companyRegistrationNumber: string | null
  vatNumber: string | null
  vatRegime: VatRegime
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  country: string | null
  taxIdentificationNumber: string | null
  tinCountry: string | null
  tinNotIssued: boolean
  accountHolderName: string | null
  /** The full IBAN is never sent back: only whether one is saved and its last 4 characters */
  hasIban: boolean
  ibanLast4: string | null
  bic: string | null
  selfBillingAccepted: boolean
  selfBillingAcceptedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export interface InformationLink {
  label: string
  url: string
}

export interface TaxProfileResponse {
  exists: boolean
  profile: TaxProfile
  status: { complete: boolean; payoutsBlocked: boolean; missingFields: string[] }
  mandate: { version: string; acceptedVersion: string | null; text: string[] }
  information: { text: string[]; links: InformationLink[] }
}

/** Omitted field = unchanged, null / '' = cleared. `iban`: '' keeps the saved account. */
export type TaxProfileUpdate = Partial<
  Omit<TaxProfile, 'hasIban' | 'ibanLast4' | 'selfBillingAcceptedAt' | 'completedAt' | 'updatedAt'>
> & { iban?: string | null }

export interface InvoiceSummary {
  id: string
  number: string
  periodStart: string
  periodEnd: string
  salesAmount: number
  platformFee: number
  netAmount: number
  vatRate: number
  vatAmount: number
  totalAmount: number
  issuedAt: string
  documentType: 'invoice' | 'credit_note'
}

export interface InvoiceLine {
  kind: 'SALE' | 'CREDIT'
  type: string
  label: string
  count: number
  salesAmount: number
  platformFee: number
  netAmount: number
}

export interface InvoiceParty {
  name: string
  address?: string[] | string
  companyRegistrationNumber?: string | null
  siren?: string
  vatNumber?: string | null
  entityType?: string
  vatRegime?: string
  country?: string | null
  profileComplete?: boolean
}

export interface InvoiceData {
  number: string
  documentType: 'invoice' | 'credit_note'
  title: string
  issuedAt: string
  period: { start: string; end: string; label: string }
  currency: string
  seller: InvoiceParty
  buyer: InvoiceParty
  description: string
  lines: InvoiceLine[]
  totals: { salesAmount: number; platformFee: number; netAmount: number; vatRate: number; vatAmount: number; totalAmount: number }
  vat: { mention: string | null; reverseCharge: boolean; reviewRequired: boolean }
  mentions: string[]
  mandate: { acceptedAt: string | null; version: string | null }
  paymentTerms: string
}

export interface InvoiceDetail extends Omit<InvoiceSummary, 'documentType'> {
  creatorId: string
  data: InvoiceData
}

export interface PeriodTotals {
  transactions: number
  salesAmount: number
  platformFee: number
  consideration: number
  refunds: number
  refundedAmount: number
  netConsideration: number
}

export interface AnnualStatement {
  year: number
  provisional: boolean
  generatedAt: string
  legalBasis: string
  seller: InvoiceParty & {
    firstName: string | null
    lastName: string | null
    companyName: string | null
    taxIdentificationNumber: string | null
    tinCountry: string | null
  }
  platform: { name: string; address: string; siren: string; vatNumber: string }
  quarters: (PeriodTotals & { quarter: number; label: string })[]
  totals: PeriodTotals
  information: { text: string[]; links: InformationLink[] }
}

export interface Dac7Quarter {
  quarter: number
  consideration: number
  activities: number
  fees: number
  refunded: number
}

export interface Dac7Record {
  creatorId: string
  username: string
  email: string
  entityType: string
  firstName: string | null
  lastName: string | null
  companyName: string | null
  country: string | null
  tin: string | null
  vatNumber: string | null
  quarters: Dac7Quarter[]
  total: Omit<Dac7Quarter, 'quarter'>
  profileComplete: boolean
  missingFields: string[]
}

export interface Dac7Report {
  year: number
  generatedAt: string
  sellers: number
  incompleteProfiles: number
  records: Dac7Record[]
}

export interface GenerationResult {
  period: string
  created: number
  skipped: number
  failed: number
  numbers: string[]
}

export interface AdminInvoice {
  id: string
  number: string
  creatorId: string
  creator: { username: string; displayName: string | null }
  netAmount: number
  vatAmount: number
  totalAmount: number
  issuedAt: string
}

export const taxApi = {
  getProfile: () => api.get<TaxProfileResponse>('/tax/profile'),
  updateProfile: (data: TaxProfileUpdate) => api.put<TaxProfileResponse>('/tax/profile', data),
  listInvoices: () => api.get<InvoiceSummary[]>('/tax/invoices'),
  getInvoice: (id: string) => api.get<InvoiceDetail>(`/tax/invoices/${encodeURIComponent(id)}`),
  listStatementYears: () => api.get<number[]>('/tax/annual-statements'),
  getAnnualStatement: (year: number) => api.get<AnnualStatement>('/tax/annual-statement', { params: { year } }),
}

export const adminTaxApi = {
  getDac7: (year: number) => api.get<Dac7Report>('/admin/tax/dac7', { params: { year, format: 'json' } }),
  /** CSV file (contains full IBANs: the download is audit-logged) */
  downloadDac7Csv: (year: number) =>
    api.get<Blob>('/admin/tax/dac7', { params: { year, format: 'csv' }, responseType: 'blob' }),
  generateInvoices: (year: number, month: number) =>
    api.post<GenerationResult>('/admin/tax/invoices/generate', { year, month }),
  listInvoices: (year: number, month: number) =>
    api.get<AdminInvoice[]>('/admin/tax/invoices', { params: { year, month } }),
}

/** Labels of the profile fields (missing fields list, errors) */
export const TAX_FIELD_LABELS: Record<string, string> = {
  profile: 'Profil fiscal',
  entityType: 'Type de vendeur',
  firstName: 'Prénom',
  lastName: 'Nom',
  dateOfBirth: 'Date de naissance',
  placeOfBirth: 'Lieu de naissance',
  companyName: 'Raison sociale',
  companyRegistrationNumber: 'SIREN / numéro d’immatriculation',
  vatNumber: 'Numéro de TVA intracommunautaire',
  vatRegime: 'Régime de TVA',
  addressLine1: 'Adresse',
  addressLine2: 'Complément d’adresse',
  postalCode: 'Code postal',
  city: 'Ville',
  country: 'Pays de résidence',
  taxIdentificationNumber: 'Numéro d’identification fiscale',
  tinCountry: 'Pays émetteur du numéro fiscal',
  accountHolderName: 'Titulaire du compte',
  iban: 'IBAN',
  bic: 'BIC',
  selfBillingAccepted: 'Mandat d’autofacturation',
}

/** Countries offered in the form (ISO 3166-1 alpha-2). Others can be typed by support. */
export const COUNTRY_OPTIONS: { code: string; label: string }[] = [
  { code: 'FR', label: 'France' },
  { code: 'BE', label: 'Belgique' },
  { code: 'CH', label: 'Suisse' },
  { code: 'LU', label: 'Luxembourg' },
  { code: 'MC', label: 'Monaco' },
  { code: 'DE', label: 'Allemagne' },
  { code: 'AT', label: 'Autriche' },
  { code: 'BG', label: 'Bulgarie' },
  { code: 'CY', label: 'Chypre' },
  { code: 'HR', label: 'Croatie' },
  { code: 'DK', label: 'Danemark' },
  { code: 'ES', label: 'Espagne' },
  { code: 'EE', label: 'Estonie' },
  { code: 'FI', label: 'Finlande' },
  { code: 'GR', label: 'Grèce' },
  { code: 'HU', label: 'Hongrie' },
  { code: 'IE', label: 'Irlande' },
  { code: 'IS', label: 'Islande' },
  { code: 'IT', label: 'Italie' },
  { code: 'LV', label: 'Lettonie' },
  { code: 'LI', label: 'Liechtenstein' },
  { code: 'LT', label: 'Lituanie' },
  { code: 'MT', label: 'Malte' },
  { code: 'NO', label: 'Norvège' },
  { code: 'NL', label: 'Pays-Bas' },
  { code: 'PL', label: 'Pologne' },
  { code: 'PT', label: 'Portugal' },
  { code: 'CZ', label: 'République tchèque' },
  { code: 'RO', label: 'Roumanie' },
  { code: 'GB', label: 'Royaume-Uni' },
  { code: 'SK', label: 'Slovaquie' },
  { code: 'SI', label: 'Slovénie' },
  { code: 'SE', label: 'Suède' },
  { code: 'CA', label: 'Canada' },
  { code: 'US', label: 'États-Unis' },
  { code: 'MA', label: 'Maroc' },
  { code: 'TN', label: 'Tunisie' },
  { code: 'SN', label: 'Sénégal' },
  { code: 'CI', label: 'Côte d’Ivoire' },
]

export function countryLabel(code: string | null | undefined): string {
  if (!code) return ''
  return COUNTRY_OPTIONS.find((c) => c.code === code)?.label ?? code
}

/** "FR7630006000011234567890189" -> "FR76 3000 6000 0112 3456 7890 189" */
export function formatIban(value: string): string {
  return value
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/(.{4})/g, '$1 ')
    .trim()
}

/** Field errors sent by the API ({ errors: { field: message } }) */
export function getFieldErrors(error: any): Record<string, string> {
  const errors = error?.response?.data?.errors
  return errors && typeof errors === 'object' && !Array.isArray(errors) ? errors : {}
}

export const formatPeriodLabel = (start: string) =>
  new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(start))

/** Dates of the documents are UTC days */
export const formatDay = (date: string | null | undefined) =>
  date ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(date)) : ''
