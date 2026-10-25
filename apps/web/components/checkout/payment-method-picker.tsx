'use client'

import { useQuery } from '@tanstack/react-query'
import { paymentsApi } from '@/lib/api'
import { CreditCard, Loader2, Plus } from 'lucide-react'

export interface SavedPaymentMethod {
  id: string
  type?: 'card'
  brand?: string | null
  last4: string | null
  expMonth?: number
  expYear?: number
  isDefault: boolean
  createdAt?: string
}

export const NEW_CARD = 'new'

/** Saved cards of the current user (same cache as /settings/payment-methods) */
export function usePaymentMethods(enabled = true) {
  return useQuery({
    queryKey: ['payment-methods'],
    queryFn: async () => (await paymentsApi.getPaymentMethods()).data as SavedPaymentMethod[],
    enabled,
  })
}

/** Selected card: the user's choice, else the default card, else a new card */
export function resolvePaymentMethod(selected: string | null, methods?: SavedPaymentMethod[]) {
  if (selected && (selected === NEW_CARD || methods?.some((m) => m.id === selected))) return selected
  return methods?.find((m) => m.isDefault)?.id || methods?.[0]?.id || NEW_CARD
}

const formatExpiry = (method: SavedPaymentMethod) =>
  method.expMonth && method.expYear ? `${method.expMonth.toString().padStart(2, '0')}/${method.expYear}` : null

interface PaymentMethodPickerProps {
  name: string
  methods?: SavedPaymentMethod[]
  loading?: boolean
  value: string
  onChange: (value: string) => void
  // Offer a new card, entered on the payment provider's secure page
  allowNewCard?: boolean
}

/**
 * Radio list of saved cards, plus "Nouvelle carte"
 */
export default function PaymentMethodPicker({
  name,
  methods,
  loading,
  value,
  onChange,
  allowNewCard = true,
}: PaymentMethodPickerProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-3" role="radiogroup">
      {methods?.map((pm) => (
        <label
          key={pm.id}
          className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${
            value === pm.id ? 'ring-2 ring-primary' : ''
          }`}
        >
          <input type="radio" name={name} checked={value === pm.id} onChange={() => onChange(pm.id)} />
          <CreditCard className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="flex-1 min-w-0 text-sm">
            <span className="capitalize">{pm.brand || 'Carte'}</span> •••• {pm.last4}
            {pm.isDefault && <span className="ml-2 text-xs text-muted-foreground">(par défaut)</span>}
          </span>
          {formatExpiry(pm) && <span className="text-xs text-muted-foreground">{formatExpiry(pm)}</span>}
        </label>
      ))}
      {allowNewCard && (
        <label
          className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${
            value === NEW_CARD ? 'ring-2 ring-primary' : ''
          }`}
        >
          <input type="radio" name={name} checked={value === NEW_CARD} onChange={() => onChange(NEW_CARD)} />
          <Plus className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm">Nouvelle carte (page de paiement sécurisée)</span>
        </label>
      )}
    </div>
  )
}
