'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { subscriptionsApi } from '@/lib/api'
import { getStripe } from '@/components/checkout/stripe-payment-element'
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
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  stripeSubscriptionId?: string | null
  pendingTierId?: string | null
  pendingTier?: TierSummary | null
  tier: TierSummary
}

interface SubscribeResult {
  requiresPayment: boolean
  subscription?: any
  stripeSubscriptionId?: string
  clientSecret?: string | null
  paymentStatus?: string
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
  const currentIsPaid = !!subscription.stripeSubscriptionId
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

export const formatTierPrice = (tier: TierSummary) =>
  Number(tier.price) === 0
    ? 'Gratuit'
    : `${Number(tier.price).toFixed(2)}€/${tier.interval === 'year' ? 'an' : 'mois'}`

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

  // Stripe may take a moment to apply the upgrade once its invoice is paid
  const waitForConfirmation = async (stripeSubscriptionId: string) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await subscriptionsApi.confirm(stripeSubscriptionId)
      if (!(response.data as SubscribeResult).requiresPayment) return
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    throw new Error('Le paiement est en cours de traitement. Votre offre sera mise à jour sous peu.')
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
      const response = await subscriptionsApi.changeTier(subscription.id, { tierId: tier.id })
      const result = response.data as SubscribeResult

      if (result.requiresPayment) {
        // Upgrade invoice needing 3D Secure, or declined
        if (!result.clientSecret || !result.stripeSubscriptionId || result.paymentStatus === 'requires_payment_method') {
          throw new Error('Le paiement de la différence a été refusé. Mettez à jour votre moyen de paiement puis réessayez.')
        }

        const stripe = await getStripe()
        if (!stripe) throw new Error('Le paiement est indisponible : clé Stripe manquante.')

        const { error: stripeError } = await stripe.confirmCardPayment(result.clientSecret)
        if (stripeError) throw stripeError

        await waitForConfirmation(result.stripeSubscriptionId)
      }

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
              `Le changement est immédiat. La différence de prix entre ${subscription.tier.name} et ${tier.name} ` +
              `pour le reste de la période en cours (jusqu'au ${periodEnd}) est calculée au prorata et débitée ` +
              `maintenant sur la carte de votre abonnement. Ensuite, ${formatTierPrice(tier)} à chaque renouvellement.`,
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
      <DialogContent>
        {text && (
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
