'use client'

import { BILLING_COUNTRIES } from '@/lib/vat'
import { Label } from '@/components/ui/label'

interface BillingCountrySelectProps {
  value: string
  onChange: (country: string) => void
}

/** Country of residence of the fan: decides the VAT rate charged */
export default function BillingCountrySelect({ value, onChange }: BillingCountrySelectProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="billing-country">Pays de résidence</Label>
      <select
        id="billing-country"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {BILLING_COUNTRIES.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </select>
    </div>
  )
}
