'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarRange, ChevronRight, FileText, Loader2, Receipt } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatEuros } from '@/lib/utils'
import { formatDay, formatPeriodLabel, taxApi } from '@/lib/tax'

export default function CreatorDocumentsPage() {
  const profile = useQuery({
    queryKey: ['tax-profile'],
    queryFn: async () => (await taxApi.getProfile()).data,
  })
  const invoices = useQuery({
    queryKey: ['tax-invoices'],
    queryFn: async () => (await taxApi.listInvoices()).data,
  })
  const years = useQuery({
    queryKey: ['tax-statement-years'],
    queryFn: async () => (await taxApi.listStatementYears()).data,
  })

  const currentYear = new Date().getFullYear()
  const statementYears = Array.from(new Set([...(years.data ?? [])])).sort((a, b) => b - a)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Documents fiscaux</h1>
        <p className="mt-2 text-muted-foreground">
          Factures établies par FanVIP en votre nom (autofacturation) et récapitulatifs annuels de vos revenus.
        </p>
      </div>

      {profile.data && !profile.data.status.complete && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Profil fiscal incomplet — vos virements sont bloqués</AlertTitle>
          <AlertDescription>
            Vos factures reprennent les informations de votre profil fiscal.{' '}
            <Link href="/creator/tax-profile" className="font-medium underline">
              Compléter mon profil
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <CalendarRange className="h-5 w-5" />
            Récapitulatifs annuels
          </CardTitle>
          <CardDescription>
            Montants perçus par trimestre et par année, tels que déclarés à l’administration fiscale (art. 242 bis du CGI).
            Le récapitulatif d’une année est définitif au plus tard le 31 janvier suivant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {years.isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : years.isError ? (
            <p className="text-sm text-destructive">Impossible de charger les récapitulatifs.</p>
          ) : statementYears.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune vente pour le moment.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {statementYears.map((year) => (
                <li key={year}>
                  <Link
                    href={`/creator/documents/releves/${year}`}
                    className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent"
                  >
                    <span>
                      <span className="block font-medium">Année {year}</span>
                      <span className="text-sm text-muted-foreground">
                        {year >= currentYear ? 'Provisoire (année en cours)' : 'Définitif'}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Receipt className="h-5 w-5" />
            Factures mensuelles
          </CardTitle>
          <CardDescription>
            Une facture par mois d’activité, émise le 1er du mois suivant. Vous disposez de 30 jours pour contester une
            facture auprès du support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : invoices.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Impossible de charger vos factures.</p>
              <Button variant="outline" size="sm" onClick={() => invoices.refetch()}>
                Réessayer
              </Button>
            </div>
          ) : !invoices.data?.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-8 w-8" />
              <p>Aucune facture pour le moment.</p>
              <p className="text-sm">Votre première facture sera émise le 1er du mois suivant vos premières ventes.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {invoices.data.map((invoice) => (
                <li key={invoice.id}>
                  <Link
                    href={`/creator/documents/factures/${invoice.id}`}
                    className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-accent/50 sm:px-2"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span>{invoice.number}</span>
                        {invoice.documentType === 'credit_note' && <Badge variant="secondary">Avoir</Badge>}
                      </p>
                      <p className="text-sm capitalize text-muted-foreground">
                        {formatPeriodLabel(invoice.periodStart)}
                        <span className="normal-case"> · émise le {formatDay(invoice.issuedAt)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-semibold tabular-nums">{formatEuros(invoice.totalAmount)}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
