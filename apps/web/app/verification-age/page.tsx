'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { AuthMessage, AuthShell } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import { useAuth } from '@/contexts/auth-context'
import { sanitizeReturnTo, startAgeVerification, useAgeVerificationStatus } from '@/lib/age-verification'

function AgeVerificationContent() {
  const searchParams = useSearchParams()
  const returnTo = sanitizeReturnTo(searchParams?.get('returnTo'))
  const { user, isLoading: authLoading } = useAuth()
  const { data: status, isLoading } = useAgeVerificationStatus({ enabled: !authLoading, userId: user?.id })
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      await startAgeVerification(returnTo)
    } catch (err: any) {
      setStarting(false)
      setError(
        err?.response?.status === 429
          ? 'Trop de tentatives. Merci de patienter une minute avant de réessayer.'
          : 'Le service de vérification est momentanément indisponible. Merci de réessayer plus tard.',
      )
    }
  }

  if (authLoading || isLoading) {
    return <AuthShell description="Vérification de l’âge" loading>{null}</AuthShell>
  }

  if (status?.verified) {
    return (
      <AuthShell description="Vérification de l’âge">
        <CardContent className="space-y-4 text-center" data-testid="age-verification-done">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" aria-hidden />
          <p className="font-medium">Votre âge est vérifié.</p>
          {status.expiresAt && (
            <p className="text-sm text-muted-foreground">
              Valable jusqu’au {new Date(status.expiresAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}.
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href={returnTo}>Continuer</Link>
          </Button>
        </CardFooter>
      </AuthShell>
    )
  }

  return (
    <AuthShell description="Vérification de l’âge">
      <CardContent className="space-y-4 text-sm" data-testid="age-verification-intro">
        <div className="flex justify-center">
          <ShieldCheck className="h-10 w-10 text-primary" aria-hidden />
        </div>
        <p>
          Les photos, vidéos, stories, lives et messages des créateurs peuvent contenir des contenus à
          caractère pornographique, interdits aux mineurs.
        </p>
        <p>
          Conformément à la loi n° 2024-449 du 21 mai 2024 (SREN) et au référentiel de l’Arcom, ces contenus
          ne peuvent s’afficher qu’après la vérification de votre âge par un service indépendant. Une simple
          déclaration (« j’ai 18 ans ») ne suffit pas.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>La vérification est réalisée par un prestataire tiers, et non par nous.</li>
          <li>
            Double anonymat : nous ne recevons jamais votre identité, seulement le résultat (majeur ou non), et
            le prestataire ne sait pas quel site vous consultez.
          </li>
          <li>
            {user
              ? 'Le résultat est associé à votre compte pour une durée limitée, après quoi une nouvelle vérification vous sera demandée.'
              : 'Le résultat est conservé dans ce navigateur pour une durée limitée, après quoi une nouvelle vérification vous sera demandée.'}
          </li>
        </ul>
        {error && <AuthMessage type="error" testId="age-verification-error">{error}</AuthMessage>}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button className="w-full" onClick={start} disabled={starting} data-testid="age-verification-start">
          {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Vérifier mon âge
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href={returnTo}>Plus tard</Link>
        </Button>
        <Link href="/legal" className="text-xs text-muted-foreground hover:underline">
          Informations légales
        </Link>
      </CardFooter>
    </AuthShell>
  )
}

export default function AgeVerificationPage() {
  return (
    <Suspense fallback={<AuthShell description="Vérification de l’âge" loading>{null}</AuthShell>}>
      <AgeVerificationContent />
    </Suspense>
  )
}
