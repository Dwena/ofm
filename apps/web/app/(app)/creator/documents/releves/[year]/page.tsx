'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AnnualStatementDocument, PrintButton } from '@/components/tax/tax-documents'
import { taxApi } from '@/lib/tax'

export default function AnnualStatementPage() {
  const params = useParams<{ year: string }>()
  const year = Number(params?.year)
  const validYear = Number.isInteger(year) && year >= 2020 && year <= 2100

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tax-annual-statement', year],
    queryFn: async () => (await taxApi.getAnnualStatement(year)).data,
    enabled: validYear,
  })

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="tax-no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link href="/creator/documents">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Mes documents
          </Link>
        </Button>
        {data && <PrintButton />}
      </div>

      {!validYear ? (
        <p className="py-12 text-center text-muted-foreground">Année invalide.</p>
      ) : isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : isError || !data ? (
        <p className="py-12 text-center text-muted-foreground">Impossible de charger le récapitulatif.</p>
      ) : (
        <AnnualStatementDocument statement={data} />
      )}
    </div>
  )
}
