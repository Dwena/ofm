'use client'

import { formatEuros } from '@/lib/utils'
import { BILLING_COUNTRIES } from '@/lib/vat'

interface PriceBreakdownProps {
  /** Euros excluding VAT */
  amount: number
  vatRate: number
  vatAmount: number
  totalAmount: number
  country?: string | null
  /** e.g. "/mois" */
  suffix?: string
}

const formatRate = (rate: number) => `${rate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`

/** Price excluding VAT, VAT of the fan's country and total charged */
export default function PriceBreakdown({ amount, vatRate, vatAmount, totalAmount, country, suffix = '' }: PriceBreakdownProps) {
  const countryName = BILLING_COUNTRIES.find((c) => c.code === country)?.name

  return (
    <div className="rounded-lg border bg-muted/50 p-4 space-y-2 text-sm">
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Prix HT</span>
        <span>{formatEuros(amount)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">
          {vatRate > 0 ? `TVA ${formatRate(vatRate)}${countryName ? ` (${countryName})` : ''}` : 'TVA'}
        </span>
        <span>{vatRate > 0 ? formatEuros(vatAmount) : 'Non applicable'}</span>
      </div>
      <div className="flex justify-between gap-4 border-t pt-2 text-base font-bold">
        <span>Total TTC</span>
        <span className="whitespace-nowrap">
          {formatEuros(totalAmount)}
          {suffix && <span className="text-sm font-normal text-muted-foreground">{suffix}</span>}
        </span>
      </div>
    </div>
  )
}
