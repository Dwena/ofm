'use client'

import Link from 'next/link'
import { getHomePath, useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { MaintenanceBanner } from '@/components/auth-shell'

const gradient = 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700'

/** Top-right buttons of the landing page: auth links, or the user's space once logged in */
export function LandingHeaderActions() {
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
        <Link href="/register">Commencer</Link>
      </Button>
    </div>
  )
}

/** Hero call-to-actions: sign up as a creator or as a subscriber */
export function LandingHeroActions() {
  const { user, isLoading } = useAuth()

  if (!isLoading && user) {
    return (
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Button asChild size="lg" className={`${gradient} text-lg px-8 py-6`}>
          <Link href={getHomePath(user.role)}>Accéder à mon espace</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="text-lg px-8 py-6 border-2">
          <Link href="/discover">Découvrir des créateurs</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col sm:flex-row gap-4 justify-center">
      <Button asChild size="lg" className={`${gradient} text-lg px-8 py-6`}>
        <Link href="/register?role=creator" data-testid="landing-cta-creator">
          Devenir Créateur
        </Link>
      </Button>
      <Button asChild size="lg" variant="outline" className="text-lg px-8 py-6 border-2">
        <Link href="/register?role=subscriber" data-testid="landing-cta-subscriber">
          S'abonner à des Créateurs
        </Link>
      </Button>
    </div>
  )
}

/** Bottom call-to-action */
export function LandingFooterCta() {
  const { user, isLoading } = useAuth()
  const loggedIn = !isLoading && !!user

  return (
    <Button asChild size="lg" variant="secondary" className="text-lg px-8 py-6">
      <Link href={loggedIn ? getHomePath(user!.role) : '/register?role=creator'}>
        {loggedIn ? 'Accéder à mon espace' : 'Créer mon compte gratuitement'}
      </Link>
    </Button>
  )
}

export function LandingMaintenanceBanner() {
  return <MaintenanceBanner className="mb-8" />
}
