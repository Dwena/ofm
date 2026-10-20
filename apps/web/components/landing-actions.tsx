'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getHomePath, useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { MaintenanceBanner, usePublicSettings } from '@/components/auth-shell'

const gradient = 'bg-indigo-600 text-white hover:bg-indigo-700'

// Platform defaults, shown until GET /settings/public answers
const DEFAULT_FEE_PERCENTAGE = 15
const DEFAULT_MINIMUM_PAYOUT = 50

const euros = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits }).format(value)

/** Commission currently configured by the admins, e.g. "15 %" */
export function PlatformFee() {
  const { data } = usePublicSettings()
  return <>{data?.platformFeePercentage ?? DEFAULT_FEE_PERCENTAGE} %</>
}

/** Minimum balance for a payout request, e.g. "50 €" */
export function MinimumPayout() {
  const { data } = usePublicSettings()
  return <>{euros(data?.minimumPayoutAmount ?? DEFAULT_MINIMUM_PAYOUT)}</>
}

/** Monthly earnings estimate from a subscriber count and a price */
export function LandingEarnings() {
  const { data } = usePublicSettings()
  const fee = data?.platformFeePercentage ?? DEFAULT_FEE_PERCENTAGE
  const [subscribers, setSubscribers] = useState(150)
  const [price, setPrice] = useState(9.99)
  const gross = subscribers * price
  const net = gross * (1 - fee / 100)

  return (
    <div className="grid gap-8 rounded-2xl border p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
      <div className="space-y-6">
        <label className="block">
          <span className="mb-2 flex justify-between text-sm">
            <span>Abonnés</span>
            <span className="font-semibold tabular-nums">{subscribers}</span>
          </span>
          <input
            type="range"
            min={10}
            max={2000}
            step={10}
            value={subscribers}
            onChange={(event) => setSubscribers(Number(event.target.value))}
            className="w-full accent-indigo-600"
            data-testid="earnings-subscribers"
          />
        </label>
        <label className="block">
          <span className="mb-2 flex justify-between text-sm">
            <span>Prix de l’abonnement</span>
            <span className="font-semibold tabular-nums">{euros(price, 2)} / mois</span>
          </span>
          <input
            type="range"
            min={2.99}
            max={49.99}
            step={1}
            value={price}
            onChange={(event) => setPrice(Number(event.target.value))}
            className="w-full accent-indigo-600"
            data-testid="earnings-price"
          />
        </label>
      </div>
      <div className="md:border-l md:pl-8 md:text-right">
        <p className="text-sm text-muted-foreground">Pour vous, chaque mois</p>
        <p className="text-4xl font-bold tabular-nums" data-testid="earnings-net">
          {euros(net)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          sur {euros(gross)} payés par vos fans, après {fee} % de commission
        </p>
      </div>
    </div>
  )
}

export type Audience = 'fans' | 'creators'

const registerHref = (audience: Audience) =>
  audience === 'creators' ? '/register?role=creator' : '/register?role=subscriber'

/** Top-right buttons of the landing pages: auth links, or the user's space once logged in */
export function LandingHeaderActions({ audience }: { audience: Audience }) {
  const { user, isLoading } = useAuth()

  if (!isLoading && user) {
    return (
      <Button asChild className={gradient}>
        <Link href={getHomePath(user.role)}>Mon espace</Link>
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2 sm:gap-4">
      <Button asChild variant="ghost">
        <Link href="/login">Connexion</Link>
      </Button>
      <Button asChild className={gradient}>
        <Link href={registerHref(audience)}>Inscription</Link>
      </Button>
    </div>
  )
}

/** Hero call-to-actions of each landing page */
export function LandingHeroActions({ audience }: { audience: Audience }) {
  const { user, isLoading } = useAuth()
  const big = 'px-8 py-6 text-lg'

  if (!isLoading && user) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row">
        <Button asChild size="lg" className={`${gradient} ${big}`}>
          <Link href={getHomePath(user.role)}>Accéder à mon espace</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className={`${big} border-2`}>
          <Link href="/discover">Découvrir des créateurs</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <Button asChild size="lg" className={`${gradient} ${big}`}>
        <Link href={registerHref(audience)} data-testid={`landing-cta-${audience}`}>
          {audience === 'creators' ? 'Créer ma page' : 'Créer mon compte'}
        </Link>
      </Button>
      <Button asChild size="lg" variant="outline" className={`${big} border-2`}>
        <Link href="/login">J’ai déjà un compte</Link>
      </Button>
    </div>
  )
}

/** Bottom call-to-action, on the dark block */
export function LandingFooterCta({ audience }: { audience: Audience }) {
  const { user, isLoading } = useAuth()
  const loggedIn = !isLoading && !!user

  return (
    <Button asChild size="lg" className="bg-white px-8 py-6 text-lg text-gray-900 hover:bg-gray-100">
      <Link href={loggedIn ? getHomePath(user!.role) : registerHref(audience)}>
        {loggedIn
          ? 'Accéder à mon espace'
          : audience === 'creators'
            ? 'Créer ma page gratuitement'
            : 'Créer mon compte gratuitement'}
      </Link>
    </Button>
  )
}

export function LandingMaintenanceBanner() {
  return <MaintenanceBanner className="mb-8" />
}
