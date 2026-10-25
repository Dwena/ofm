'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { subscriptionsApi } from '@/lib/api'
import { formatFanPrice } from '@/lib/vat'
import { formatEuros } from '@/lib/utils'
import PaymentCheckout from '@/components/checkout/payment-checkout'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export interface TierSummary {
  id: string
  name: string
  price: string | number
  interval?: string
}

export interface ChangeableSubscription {
  id: string
  tierId: string
  status: string
  currentPeriodStart?: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  pendingTierId?: string | null
  pendingTier?: TierSummary | null
  tier: TierSummary
}

/**
 * How switching to `tier` behaves, mirroring SubscriptionsService.changeTier:
 * - upgrade: immediate, prorated difference charged now
 * - downgrade: lower paid tier at the end of the paid period
 * - to-free: paid subscription ends at period end, then the free tier starts
 * - checkout: free → paid, through the regular payment flow
 * - free-switch: free → free, immediate
 * - undo: back to the current tier, dropping a scheduled change
 */
export type TierChangeKind = 'upgrade' | 'downgrade' | 'to-free' | 'checkout' | 'free-switch' | 'undo'

export function getTierChangeKind(subscription: ChangeableSubscription, tier: TierSummary): TierChangeKind {
  const currentIsPaid = Number(subscription.tier.price) > 0
  const targetPrice = Number(tier.price)

  if (tier.id === subscription.tierId) return 'undo'
  if (!currentIsPaid) return targetPrice > 0 ? 'checkout' : 'free-switch'
  if (targetPrice <= 0) return 'to-free'

  const sameInterval = (tier.interval || 'month') === (subscription.tier.interval || 'month')
  return sameInterval && targetPrice < Number(subscription.tier.price) ? 'downgrade' : 'upgrade'
}

/**
 * Label of the button offering to switch to `tier`
 */
export function getTierChangeLabel(subscription: ChangeableSubscription, tier: TierSummary) {
  const kind = getTierChangeKind(subscription, tier)
  return kind === 'downgrade' || kind === 'to-free' ? 'Rétrograder' : 'Passer à ce palier'
}

export const formatDate = (date: string) => new Date(date).toLocaleDateString('fr-FR')

/**
 * Price excluding VAT charged now for an upgrade, as computed by the API
 * (BillingService.upgradePrice): new price minus the unused part of the period
 */
export function estimateUpgradePrice(subscription: ChangeableSubscription, tier: TierSummary, now = Date.now()) {
  const end = new Date(subscription.currentPeriodEnd).getTime()
  const length =
    subscription.currentPeriodStart
      ? end - new Date(subscription.currentPeriodStart).getTime()
      : (subscription.tier.interval === 'year' ? 365 : 30) * 24 * 60 * 60 * 1000
  const remaining = Math.max(0, end - now)
  const credit = length > 0 ? (Number(subscription.tier.price) * remaining) / length : 0
  const price = Math.round(Math.max(0, Number(tier.price) - credit) * 100) / 100
  return Math.max(price, 0.5)
}

export const formatTierPrice = (tier: TierSummary) =>
  Number(tier.price) === 0
    ? 'Gratuit'
    : `${formatFanPrice(tier.price)}/${tier.interval === 'year' ? 'an' : 'mois'}`

/**
 * "Passera à X le <date>" for a scheduled downgrade
 */
export function getPendingChangeLabel(subscription: ChangeableSubscription) {
  if (!subscription.pendingTierId) return null
  const name = subscription.pendingTier?.name || 'une autre offre'
  return `Passera à ${name} le ${formatDate(subscription.currentPeriodEnd)}`
}

interface ChangeTierDialogProps {
  subscription: ChangeableSubscription | null
  tier: TierSummary | null
  // For the checkout description and redirect (free → paid)
  creatorUsername: string
  returnUrl: string
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

const getErrorMessage = (error: any) =>
  error?.response?.data?.message || error?.message || 'Une erreur est survenue'

export default function ChangeTierDialog({
  subscription,
  tier,
  creatorUsername,
  returnUrl,
  onOpenChange,
  onChanged,
}: ChangeTierDialogProps) {
  const router = useRouter()
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = !!subscription && !!tier
  const kind = subscription && tier ? getTierChangeKind(subscription, tier) : null

  const close = () => {
    if (isProcessing) return
    setError(null)
    onOpenChange(false)
  }

  const handleConfirm = async () => {
    if (!subscription || !tier || !kind) return

    if (kind === 'checkout') {
      const params = new URLSearchParams({
        type: 'subscription',
        itemId: tier.id,
        amount: String(Number(tier.price)),
        description: `${tier.name} - @${creatorUsername}`,
        returnUrl,
        changeFrom: subscription.id,
      })
      router.push(`/checkout?${params.toString()}`)
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      await subscriptionsApi.changeTier(subscription.id, { tierId: tier.id })

      toast({
        title:
          kind === 'upgrade' || kind === 'free-switch'
            ? `Vous êtes passé à ${tier.name}`
            : kind === 'undo'
              ? 'Changement d\'offre annulé'
              : `Passage à ${tier.name} programmé`,
      })
      setIsProcessing(false)
      onOpenChange(false)
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
      setIsProcessing(false)
      // The subscription may have changed even if the confirmation failed
      onChanged()
    }
  }

  const periodEnd = subscription ? formatDate(subscription.currentPeriodEnd) : ''

  const content: Record<TierChangeKind, { title: string; description: string; confirm: string }> | null =
    subscription && tier
      ? {
          upgrade: {
            title: `Passer à ${tier.name}`,
            description:
              `Une nouvelle période à ${tier.name} commence dès le paiement. La partie non utilisée de votre ` +
              `période en cours (jusqu'au ${periodEnd}) est déduite du prix. Ensuite, ${formatTierPrice(tier)} ` +
              `à chaque renouvellement.`,
            confirm: 'Passer à ce palier',
          },
          downgrade: {
            title: `Rétrograder vers ${tier.name}`,
            description:
              `Vous gardez ${subscription.tier.name}, déjà payé, jusqu'au ${periodEnd}. Vous passerez ensuite à ` +
              `${tier.name} pour ${formatTierPrice(tier)}. Aucun remboursement au prorata n'est effectué.`,
            confirm: 'Rétrograder',
          },
          'to-free': {
            title: `Rétrograder vers ${tier.name}`,
            description:
              `Votre abonnement payant ${subscription.tier.name} reste actif jusqu'au ${periodEnd} et ne sera pas ` +
              `renouvelé. Vous passerez ensuite à l'offre gratuite ${tier.name}. Aucun remboursement au prorata.`,
            confirm: 'Rétrograder',
          },
          checkout: {
            title: `Passer à ${tier.name}`,
            description:
              `Vous allez être redirigé vers le paiement de ${tier.name} (${formatTierPrice(tier)}). ` +
              `Votre offre gratuite actuelle prendra fin dès l'activation du nouvel abonnement.`,
            confirm: 'Continuer vers le paiement',
          },
          'free-switch': {
            title: `Passer à ${tier.name}`,
            description: `Vous passerez immédiatement de ${subscription.tier.name} à ${tier.name}.`,
            confirm: 'Passer à ce palier',
          },
          undo: {
            title: `Conserver ${tier.name}`,
            description: subscription.pendingTier
              ? `Le passage à ${subscription.pendingTier.name} prévu le ${periodEnd} sera annulé et votre ` +
                `abonnement ${tier.name} sera renouvelé normalement.`
              : `Votre abonnement ${tier.name} sera renouvelé normalement.`,
            confirm: 'Conserver cette offre',
          },
        }
      : null

  const text = kind && content ? content[kind] : null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className={kind === 'upgrade' ? 'max-w-lg max-h-[90vh] overflow-y-auto' : undefined}>
        {text && kind === 'upgrade' && subscription && tier ? (
          <>
            <DialogHeader>
              <DialogTitle>{text.title}</DialogTitle>
              <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>
            <PaymentCheckout
              kind="subscription"
              compact
              amount={estimateUpgradePrice(subscription, tier)}
              interval={tier.interval}
              description={`Passage à ${tier.name} (montant au prorata)`}
              start={async (options) => (await subscriptionsApi.changeTier(subscription.id, { tierId: tier.id, ...options })).data}
              confirm={async (transactionId) => (await subscriptionsApi.confirm(transactionId)).data}
              successDelay={1200}
              onSuccess={() => {
                onOpenChange(false)
                onChanged()
              }}
              onCancel={close}
            />
          </>
        ) : text && (
          <>
            <DialogHeader>
              <DialogTitle>{text.title}</DialogTitle>
              <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={close} disabled={isProcessing}>
                Annuler
              </Button>
              <Button onClick={handleConfirm} disabled={isProcessing}>
                {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {text.confirm}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
