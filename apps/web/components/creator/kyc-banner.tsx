'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Clock, ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { verificationApi } from '@/lib/verification'

/**
 * Reminder shown to creators whose identity is not verified yet: they cannot
 * publish content, stories or lives until it is
 */
export function KycBanner({ className }: { className?: string }) {
  const { data } = useQuery({
    queryKey: ['creator-verification'],
    queryFn: async () => (await verificationApi.getStatus()).data,
    staleTime: 60_000,
  })

  if (!data || data.kycStatus === 'VERIFIED') return null

  const pending = data.kycStatus === 'PENDING' || data.kycStatus === 'UNDER_REVIEW'

  return (
    <Alert className={className} variant={pending ? 'default' : 'destructive'} data-testid="kyc-banner">
      {pending ? <Clock className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
      <AlertTitle>{pending ? 'Vérification d’identité en cours' : 'Vérifiez votre identité pour publier'}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {pending
            ? 'Vous pourrez publier dès que notre équipe aura validé vos documents. Vous pouvez déjà préparer des brouillons.'
            : data.kycStatus === 'NOT_STARTED'
              ? 'Une pièce d’identité et un selfie sont nécessaires avant de publier des contenus, des stories ou des lives.'
              : `Votre vérification a été refusée${data.kycRejectionReason ? ` : ${data.kycRejectionReason}` : ''}. Envoyez de nouveaux documents.`}
        </span>
        {!pending && (
          <Button asChild size="sm" variant="outline">
            <Link href="/creator/verification">Vérifier mon identité</Link>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
