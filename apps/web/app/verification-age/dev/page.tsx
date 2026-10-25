'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { FlaskConical } from 'lucide-react'
import { AuthMessage, AuthShell } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import { buildDevCallbackUrl } from '@/lib/age-verification'

/**
 * Development simulator of the third-party age verification (API provider
 * `dev`, refused by the API in production). It stands for the certified
 * provider's pages: a real provider verifies the age, this one just asks.
 */
function DevSimulator() {
  const searchParams = useSearchParams()
  const state = searchParams?.get('state') || ''
  const nonce = searchParams?.get('nonce') || ''

  if (process.env.NODE_ENV === 'production') {
    return (
      <AuthShell description="Simulateur de vérification de l’âge">
        <CardContent>
          <AuthMessage type="error">Ce simulateur n’est pas disponible en production.</AuthMessage>
        </CardContent>
      </AuthShell>
    )
  }

  const answer = (result: 'adult' | 'minor') => {
    window.location.assign(buildDevCallbackUrl(state, nonce, result))
  }

  return (
    <AuthShell description="Simulateur de vérification de l’âge (développement)">
      <CardContent className="space-y-4 text-sm" data-testid="age-verification-dev">
        <div className="flex justify-center">
          <FlaskConical className="h-10 w-10 text-amber-500" aria-hidden />
        </div>
        <AuthMessage type="info">
          Environnement de développement : cette page simule le service tiers de vérification de l’âge. En
          production, un prestataire conforme au référentiel de l’Arcom vérifie réellement l’âge.
        </AuthMessage>
        {!state || !nonce ? (
          <AuthMessage type="error">Paramètres de vérification manquants.</AuthMessage>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button className="w-full" disabled={!state || !nonce} onClick={() => answer('adult')} data-testid="age-dev-adult">
          Je suis majeur(e)
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={!state || !nonce}
          onClick={() => answer('minor')}
          data-testid="age-dev-minor"
        >
          Je suis mineur(e)
        </Button>
      </CardFooter>
    </AuthShell>
  )
}

export default function AgeVerificationDevPage() {
  return (
    <Suspense fallback={<AuthShell description="Simulateur de vérification de l’âge" loading>{null}</AuthShell>}>
      <DevSimulator />
    </Suspense>
  )
}
