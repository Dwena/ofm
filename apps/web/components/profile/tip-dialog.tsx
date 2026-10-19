'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatEuros } from '@/lib/utils'

const MAX_TIP = 10000
const MAX_MESSAGE = 500

interface TipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  creator: { id: string; username: string; displayName?: string | null }
  // Euros, from the creator's settings
  minimumTip: number
  returnUrl: string
}

/**
 * Pick a tip amount and an optional message, then pay on the checkout page
 */
export default function TipDialog({ open, onOpenChange, creator, minimumTip, returnUrl }: TipDialogProps) {
  const router = useRouter()
  const min = Math.max(1, minimumTip || 1)
  const presets = Array.from(new Set([min, 10, 20, 50].filter((value) => value >= min))).slice(0, 4)

  const [amount, setAmount] = useState(String(min))
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setAmount(String(min))
      setMessage('')
      setError(null)
    }
  }, [open, min])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const value = Number(amount.replace(',', '.'))

    if (!Number.isFinite(value) || value <= 0) {
      setError('Saisissez un montant valide.')
      return
    }
    if (value < min) {
      setError(`Le pourboire minimum est de ${formatEuros(min)}.`)
      return
    }
    if (value > MAX_TIP) {
      setError(`Le pourboire maximum est de ${formatEuros(MAX_TIP)}.`)
      return
    }
    if (!/^\d+([.,]\d{1,2})?$/.test(amount.trim())) {
      setError('Le montant ne peut pas avoir plus de 2 décimales.')
      return
    }

    const params = new URLSearchParams({
      type: 'tip',
      itemId: creator.id,
      amount: String(value),
      description: `Pourboire pour @${creator.username}`,
      returnUrl,
    })
    if (message.trim()) params.set('message', message.trim())
    router.push(`/checkout?${params.toString()}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Envoyer un pourboire</DialogTitle>
            <DialogDescription>
              Soutenez {creator.displayName || `@${creator.username}`}. Minimum {formatEuros(min)}.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={Number(amount) === preset ? 'default' : 'outline'}
                onClick={() => {
                  setAmount(String(preset))
                  setError(null)
                }}
              >
                {formatEuros(preset)}
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tip-amount">Montant (€)</Label>
            <Input
              id="tip-amount"
              type="number"
              inputMode="decimal"
              min={min}
              max={MAX_TIP}
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setError(null)
              }}
              aria-invalid={!!error}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tip-message">Message (facultatif)</Label>
            <Textarea
              id="tip-message"
              value={message}
              maxLength={MAX_MESSAGE}
              rows={3}
              placeholder="Un petit mot pour le créateur…"
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground text-right">
              {message.length}/{MAX_MESSAGE}
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit">Continuer vers le paiement</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
