'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import {
  buildAgeVerificationUrl,
  dismissInterstitial,
  isInterstitialDismissed,
  useAgeVerificationStatus,
} from '@/lib/age-verification'

const QUIT_URL = 'https://www.google.com'

/** Pages that never show the warning (the verification itself, legal texts, OBS overlays) */
const EXCLUDED_PATHS = /^\/(verification-age|legal|overlay)(\/|$)/

/**
 * First-visit warning for visitors whose age is not verified. Explicit media
 * stay hidden by the API until the verification (a self-declaration is not
 * enough), so "Continuer sans vérifier" only gives access to the
 * non-explicit parts of the site (creator profiles, texts, prices).
 */
export function AgeGateInterstitial() {
  const pathname = usePathname() || '/'
  const router = useRouter()
  const excluded = EXCLUDED_PATHS.test(pathname)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(isInterstitialDismissed())
  }, [])

  const { user, isLoading: authLoading } = useAuth()
  const { data: status, isLoading, isError } = useAgeVerificationStatus({
    enabled: !excluded && !dismissed && !authLoading,
    userId: user?.id,
  })

  if (excluded || dismissed || authLoading || isLoading || status?.verified) return null
  // API unreachable: no status, still warn the visitor
  if (!status && !isError) return null

  const verify = () => {
    dismissInterstitial()
    router.push(buildAgeVerificationUrl(pathname + window.location.search))
  }

  const continueWithout = () => {
    dismissInterstitial()
    setDismissed(true)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      data-testid="age-gate-interstitial"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
    >
      <div className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30">
            <ShieldAlert className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="age-gate-title" className="text-lg font-semibold">
            Site réservé aux adultes
          </h2>
        </div>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Ce site contient du contenu réservé aux adultes, dont des contenus à caractère pornographique.
            Il est interdit aux mineurs.
          </p>
          <p>
            Conformément à la loi n° 2024-449 du 21 mai 2024 (SREN), ces contenus ne s’affichent qu’après
            vérification de votre âge par un service indépendant. Une simple déclaration ne suffit pas, et
            nous ne recevons jamais votre identité : seulement le résultat de la vérification.
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" asChild>
            <a href={QUIT_URL} data-testid="age-gate-quit">
              Quitter
            </a>
          </Button>
          <Button onClick={verify} data-testid="age-gate-verify">
            Vérifier mon âge
          </Button>
        </div>
        <button
          type="button"
          onClick={continueWithout}
          className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
          data-testid="age-gate-continue"
        >
          Continuer sans vérifier (les contenus pour adultes resteront masqués)
        </button>
      </div>
    </div>
  )
}
