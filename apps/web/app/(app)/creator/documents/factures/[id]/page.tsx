'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InvoiceDocument, PrintButton } from '@/components/tax/tax-documents'
import { taxApi } from '@/lib/tax'

export default function InvoicePage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['tax-invoice', id],
    queryFn: async () => (await taxApi.getInvoice(id!)).data,
    enabled: !!id,
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

      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : isError || !data ? (
        <p className="py-12 text-center text-muted-foreground">
          {(error as any)?.response?.status === 404 ? 'Facture introuvable.' : 'Impossible de charger la facture.'}
        </p>
      ) : (
        <InvoiceDocument invoice={data} />
      )}
    </div>
  )
}
