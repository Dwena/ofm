'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { XCircle } from 'lucide-react'
import { AuthMessage, AuthShell } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import {
  AgeVerificationCallbackResult,
  buildAgeVerificationUrl,
  describeAgeVerificationFailure,
  parseAgeVerificationFragment,
  storeAgeToken,
} from '@/lib/age-verification'

/**
 * Return from the verification: the API puts the outcome in the URL fragment
 * (never sent to a server). A verified visitor gets the anonymous token
 * stored and is sent back to the page they came from.
 */
export default function AgeVerificationReturnPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [result, setResult] = useState<AgeVerificationCallbackResult | null>(null)

  useEffect(() => {
    const parsed = parseAgeVerificationFragment(window.location.hash)
    // Drop the token from the address bar and the history
    window.history.replaceState(null, '', window.location.pathname)

    if (parsed.status === 'verified' && parsed.token && parsed.expiresAt) {
      storeAgeToken(parsed.token, parsed.expiresAt)
      // Media fetched before the verification were returned without their URLs
      void queryClient.invalidateQueries()
      router.replace(parsed.returnTo)
      return
    }
    setResult(parsed)
  }, [queryClient, router])

  if (!result) {
    return <AuthShell description="Vérification de l’âge" loading>{null}</AuthShell>
  }

  return (
    <AuthShell description="Vérification de l’âge">
      <CardContent className="space-y-4 text-center" data-testid="age-verification-failed">
        <XCircle className="mx-auto h-10 w-10 text-red-500" aria-hidden />
        <AuthMessage type="error">{describeAgeVerificationFailure(result.reason)}</AuthMessage>
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link href={buildAgeVerificationUrl(result.returnTo)}>Réessayer</Link>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href={result.returnTo}>Retour au site</Link>
        </Button>
      </CardFooter>
    </AuthShell>
  )
}
