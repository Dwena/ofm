'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import SubscriptionCheckout, { PENDING_SUBSCRIPTION_PARAM } from '@/components/checkout/subscription-checkout'
import OneTimeCheckout, { type OneTimePaymentResult } from '@/components/checkout/one-time-checkout'
import { isStripeConfigured, STRIPE_NOT_CONFIGURED_MESSAGE } from '@/components/checkout/stripe-payment-element'
import { contentApi, liveApi, paymentsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { getPaymentErrorMessage } from '@/lib/payment-errors'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AlertCircle, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react'

type CheckoutType = 'subscription' | 'ppv' | 'stream' | 'tip'

const CHECKOUT_TYPES: CheckoutType[] = ['subscription', 'ppv', 'stream', 'tip']

/** GET /payments/checkout-info */
interface CheckoutInfo {
  type: CheckoutType
  itemId: string
  title: string
  amount: number | null // euros, null for tips
  interval?: string
  minimumTip?: number
  maximumTip?: number
  creator: { id: string; username: string; displayName: string | null; avatar: string | null }
  available: boolean
  unavailableReason?: 'PAYMENTS_DISABLED' | 'CREATOR_NOT_READY' | 'TIPS_DISABLED' | 'OWN_ITEM' | 'NOT_PAID' | 'ENDED'
  alreadyOwned: boolean
}

const UNAVAILABLE_MESSAGES: Record<NonNullable<CheckoutInfo['unavailableReason']>, string> = {
  PAYMENTS_DISABLED: STRIPE_NOT_CONFIGURED_MESSAGE,
  CREATOR_NOT_READY:
    'Ce créateur n’a pas encore activé les paiements : il n’est pas possible de le payer pour le moment.',
  TIPS_DISABLED: 'Ce créateur n’accepte pas les pourboires.',
  OWN_ITEM: 'Vous ne pouvez pas payer pour votre propre contenu.',
  NOT_PAID: 'Cet élément est gratuit : aucun paiement n’est nécessaire.',
  ENDED: 'Ce live est terminé, il ne peut plus être acheté.',
}

const ALREADY_OWNED: Record<CheckoutType, { title: string; description: string }> = {
  subscription: { title: 'Déjà abonné', description: 'Vous êtes déjà abonné à cette offre.' },
  ppv: { title: 'Contenu déjà débloqué', description: 'Vous avez déjà acheté ce contenu.' },
  stream: { title: 'Live déjà acheté', description: 'Vous avez déjà accès à ce live.' },
  tip: { title: '', description: '' },
}

const DEFAULT_MAXIMUM_TIP = 10000

// Only same-site paths: never redirect to another origin after paying
const safeReturnUrl = (value: string | null) =>
  value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/feed'

const parseEuros = (value: string) => Number(value.replace(',', '.').trim())

/**
 * /checkout?type=subscription|ppv|stream|tip&itemId=...&description=...&returnUrl=...
 *
 * - itemId: tier id (subscription), content id (ppv), stream id (stream), creator id (tip)
 * - the price shown and charged comes from the API; `amount` (euros) is only
 *   the suggested amount of a tip
 * - tip only: optional `message` and `streamId`
 * - subscription only: `changeFrom`, free subscription upgraded to this tier
 */
export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <Checkout />
    </Suspense>
  )
}

function Checkout() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()

  const rawType = searchParams.get('type') as CheckoutType | null
  const type = rawType && CHECKOUT_TYPES.includes(rawType) ? rawType : null
  const itemId = searchParams.get('itemId') || ''
  const description = searchParams.get('description')
  const streamId = searchParams.get('streamId') || undefined
  const returnUrl = safeReturnUrl(searchParams.get('returnUrl'))
  const changeFrom = searchParams.get('changeFrom') || undefined
  const suggestedTip = parseEuros(searchParams.get('amount') || '')

  // Back from a Stripe redirect (3D Secure page)
  const redirectStatus = searchParams.get('redirect_status')
  const paymentIntentParam = searchParams.get('payment_intent')
  const pendingSubscription = searchParams.get(PENDING_SUBSCRIPTION_PARAM)
  const subscriptionResume = useMemo(
    () =>
      redirectStatus && pendingSubscription
        ? { stripeSubscriptionId: pendingSubscription, status: redirectStatus }
        : undefined,
    [redirectStatus, pendingSubscription],
  )
  const oneTimeResume = useMemo(
    () =>
      redirectStatus && paymentIntentParam && !pendingSubscription
        ? { paymentIntentId: paymentIntentParam, status: redirectStatus }
        : undefined,
    [redirectStatus, paymentIntentParam, pendingSubscription],
  )
  const resuming = !!(subscriptionResume || oneTimeResume)

  const [tipInput, setTipInput] = useState<string | null>(null)
  const [tipMessage, setTipMessage] = useState(searchParams.get('message') || '')
  const [tipTouched, setTipTouched] = useState(false)

  const {
    data: info,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['checkout-info', type, itemId],
    queryFn: async () => (await paymentsApi.getCheckoutInfo(type!, itemId)).data as CheckoutInfo,
    enabled: !!type && !!itemId,
    retry: false,
  })

  const goBack = () => router.push(returnUrl)

  const done = () => {
    // Content, streams and subscriptions just became accessible
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    queryClient.invalidateQueries({ queryKey: ['creator-content'] })
    queryClient.invalidateQueries({ queryKey: ['content'] })
    queryClient.invalidateQueries({ queryKey: ['live-stream'] })
    queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['subscription-status'] })
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
    // A new card may have been saved
    queryClient.invalidateQueries({ queryKey: ['payment-methods'] })
    router.push(returnUrl)
  }

  if (!type || !itemId) {
    return (
      <StatusCard
        icon="error"
        title="Paramètres invalides"
        description="Les paramètres de paiement sont manquants ou invalides."
        primary={{ label: 'Retour', onClick: goBack }}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !info) {
    const status = (error as any)?.response?.status
    return (
      <StatusCard
        icon="error"
        title={status === 404 ? 'Élément introuvable' : 'Paiement indisponible'}
        description={
          status === 404
            ? 'Cet élément n’existe plus ou n’est plus disponible à l’achat.'
            : getPaymentErrorMessage(error, 'Impossible de préparer le paiement. Veuillez réessayer.')
        }
        primary={status === 404 ? { label: 'Retour', onClick: goBack } : { label: 'Réessayer', onClick: () => refetch() }}
        secondary={status === 404 ? undefined : { label: 'Retour', onClick: goBack }}
      />
    )
  }

  const creatorName = info.creator.displayName || info.creator.username

  if (!resuming && info.alreadyOwned) {
    return (
      <StatusCard
        icon="success"
        title={ALREADY_OWNED[type].title}
        description={ALREADY_OWNED[type].description}
        primary={{ label: 'Continuer', onClick: done }}
        secondary={type === 'subscription' ? { label: 'Mes abonnements', href: '/subscriptions' } : undefined}
      />
    )
  }

  const unavailableReason =
    info.unavailableReason ?? (!isStripeConfigured() ? 'PAYMENTS_DISABLED' : undefined)

  if (!resuming && unavailableReason) {
    return (
      <StatusCard
        icon="error"
        title="Paiement impossible"
        description={UNAVAILABLE_MESSAGES[unavailableReason]}
        primary={{ label: 'Retour', onClick: goBack }}
        secondary={
          unavailableReason !== 'OWN_ITEM'
            ? { label: `Voir le profil de ${creatorName}`, href: `/${info.creator.username}` }
            : undefined
        }
      />
    )
  }

  // Tip amount chosen by the fan, within the creator's limits
  const minimumTip = info.minimumTip ?? 1
  const maximumTip = info.maximumTip ?? DEFAULT_MAXIMUM_TIP
  const tipValue =
    tipInput ?? String(Number.isFinite(suggestedTip) && suggestedTip >= minimumTip ? suggestedTip : minimumTip)
  const tipAmount = parseEuros(tipValue)
  const tipError =
    type !== 'tip'
      ? null
      : !Number.isFinite(tipAmount) || tipValue.trim() === ''
        ? 'Saisissez un montant.'
        : tipAmount < minimumTip
          ? `Le pourboire minimum est de ${formatEuros(minimumTip)}.`
          : tipAmount > maximumTip
            ? `Le pourboire maximum est de ${formatEuros(maximumTip)}.`
            : !/^\d+([.,]\d{1,2})?$/.test(tipValue.trim())
              ? 'Le montant ne peut pas avoir plus de 2 décimales.'
              : tipMessage.length > 500
                ? 'Le message ne peut pas dépasser 500 caractères.'
                : null

  const amount = type === 'tip' ? (Number.isFinite(tipAmount) ? tipAmount : 0) : (info.amount ?? 0)
  const itemDescription =
    type === 'tip'
      ? `Pourboire pour @${info.creator.username}`
      : type === 'subscription'
        ? `${info.title} - @${info.creator.username}`
        : description || `${info.title} - @${info.creator.username}`

  const handlers: Record<
    Exclude<CheckoutType, 'subscription'>,
    {
      start: (paymentMethodId?: string) => Promise<OneTimePaymentResult>
      confirm: (paymentIntentId: string) => Promise<OneTimePaymentResult>
    }
  > = {
    ppv: {
      start: async (paymentMethodId) => (await contentApi.unlockPPV(itemId, paymentMethodId)).data,
      confirm: async (paymentIntentId) => (await contentApi.confirmUnlock(itemId, paymentIntentId)).data,
    },
    stream: {
      start: async (paymentMethodId) => (await liveApi.purchase(itemId, paymentMethodId)).data,
      confirm: async (paymentIntentId) => (await liveApi.confirmPurchase(itemId, paymentIntentId)).data,
    },
    tip: {
      start: async (paymentMethodId) =>
        (
          await paymentsApi.sendTip(itemId, {
            amount: tipAmount,
            message: tipMessage.trim() || undefined,
            streamId,
            paymentMethodId,
          })
        ).data,
      confirm: async (paymentIntentId) => (await paymentsApi.confirmTip(itemId, paymentIntentId)).data,
    },
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button variant="ghost" onClick={goBack}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Retour
      </Button>

      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">Paiement sécurisé</h1>
        <p className="text-muted-foreground">Complétez votre achat en toute sécurité avec Stripe</p>
      </div>

      <Link
        href={`/${info.creator.username}`}
        className="max-w-md mx-auto flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
      >
        <Avatar>
          <AvatarImage src={info.creator.avatar || undefined} />
          <AvatarFallback>{creatorName.substring(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="font-medium truncate">{creatorName}</p>
          <p className="text-sm text-muted-foreground truncate">@{info.creator.username}</p>
        </div>
      </Link>

      {type === 'subscription' ? (
        <SubscriptionCheckout
          tierId={itemId}
          amount={amount}
          interval={info.interval}
          description={itemDescription}
          changeFromSubscriptionId={changeFrom}
          resume={subscriptionResume}
          onSuccess={done}
          onCancel={goBack}
        />
      ) : (
        <OneTimeCheckout
          kind={type}
          amount={amount}
          description={itemDescription}
          start={handlers[type].start}
          confirm={handlers[type].confirm}
          resume={oneTimeResume}
          disabled={!!tipError}
          summaryExtra={
            type === 'tip' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tip-amount">Montant (€)</Label>
                  <Input
                    id="tip-amount"
                    type="number"
                    inputMode="decimal"
                    min={minimumTip}
                    max={maximumTip}
                    step="0.01"
                    value={tipValue}
                    onChange={(e) => setTipInput(e.target.value)}
                    onBlur={() => setTipTouched(true)}
                    aria-invalid={!!tipError}
                  />
                  {tipError && (tipTouched || tipInput !== null) ? (
                    <p className="text-sm text-destructive">{tipError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Minimum {formatEuros(minimumTip)}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 20, 50]
                    .filter((preset) => preset >= minimumTip && preset <= maximumTip)
                    .map((preset) => (
                      <Button
                        key={preset}
                        type="button"
                        size="sm"
                        variant={tipAmount === preset ? 'default' : 'outline'}
                        onClick={() => setTipInput(String(preset))}
                      >
                        {formatEuros(preset)}
                      </Button>
                    ))}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tip-message">Message (optionnel)</Label>
                  <Textarea
                    id="tip-message"
                    value={tipMessage}
                    maxLength={500}
                    rows={3}
                    placeholder={`Un mot pour ${creatorName}...`}
                    onChange={(e) => setTipMessage(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground text-right">{tipMessage.length}/500</p>
                </div>
              </div>
            ) : undefined
          }
          onSuccess={done}
          onCancel={goBack}
        />
      )}
    </div>
  )
}

type StatusAction = { label: string; onClick?: () => void; href?: string }

function StatusCard({
  icon,
  title,
  description,
  primary,
  secondary,
}: {
  icon: 'success' | 'error'
  title: string
  description: string
  primary: StatusAction
  secondary?: StatusAction
}) {
  const renderAction = (action: StatusAction, variant: 'default' | 'outline') =>
    action.href ? (
      <Button asChild variant={variant} className="flex-1">
        <Link href={action.href}>{action.label}</Link>
      </Button>
    ) : (
      <Button variant={variant} onClick={action.onClick} className="flex-1">
        {action.label}
      </Button>
    )

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center">
          <div
            className={`h-16 w-16 rounded-full mx-auto mb-4 flex items-center justify-center ${
              icon === 'success' ? 'bg-green-100' : 'bg-red-100'
            }`}
          >
            {icon === 'success' ? (
              <CheckCircle className="h-8 w-8 text-green-600" />
            ) : (
              <AlertCircle className="h-8 w-8 text-red-600" />
            )}
          </div>
          <h2 className="text-xl font-semibold mb-2">{title}</h2>
          <p className="text-muted-foreground mb-4">{description}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {secondary && renderAction(secondary, 'outline')}
            {renderAction(primary, 'default')}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
