'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Info, Loader2, Receipt, Search } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { getErrorMessage, formatDateTime } from '@/components/admin/admin-shared'
import { formatEuros } from '@/lib/utils'
import { adminTaxApi, countryLabel, TAX_FIELD_LABELS, type Dac7Report, type GenerationResult } from '@/lib/tax'

const selectClass =
  'flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

function defaultReportYear(now = new Date()) {
  // The declaration of year N is filed in January N+1
  return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
}

function previousMonthValue(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Error body of a blob request (the API answers JSON on errors) */
async function blobErrorMessage(error: any, fallback: string) {
  const data = error?.response?.data
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text())?.message ?? fallback
    } catch {
      return fallback
    }
  }
  return getErrorMessage(error, fallback)
}

export default function AdminTaxPage() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, index) => currentYear - index)

  const [year, setYear] = useState(defaultReportYear())
  const [report, setReport] = useState<Dac7Report | null>(null)
  const [month, setMonth] = useState(previousMonthValue())
  const [generation, setGeneration] = useState<GenerationResult | null>(null)

  const [monthYear, monthNumber] = month.split('-').map(Number)
  const validMonth = Number.isInteger(monthYear) && Number.isInteger(monthNumber)

  const preview = useMutation({
    mutationFn: async () => (await adminTaxApi.getDac7(year)).data,
    onSuccess: setReport,
    onError: (error) =>
      toast({ title: 'Aperçu impossible', description: getErrorMessage(error), variant: 'destructive' }),
  })

  const download = useMutation({
    mutationFn: async () => {
      const response = await adminTaxApi.downloadDac7Csv(year)
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `dac7-${year}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    },
    onError: async (error) =>
      toast({
        title: 'Téléchargement impossible',
        description: await blobErrorMessage(error, 'Une erreur est survenue'),
        variant: 'destructive',
      }),
  })

  const invoices = useQuery({
    queryKey: ['admin-tax-invoices', month],
    queryFn: async () => (await adminTaxApi.listInvoices(monthYear, monthNumber)).data,
    enabled: validMonth,
  })

  const generate = useMutation({
    mutationFn: async () => (await adminTaxApi.generateInvoices(monthYear, monthNumber)).data,
    onSuccess: (result) => {
      setGeneration(result)
      queryClient.invalidateQueries({ queryKey: ['admin-tax-invoices', month] })
      toast({ title: 'Génération terminée', description: `${result.created} facture(s) créée(s)` })
    },
    onError: (error) =>
      toast({ title: 'Génération impossible', description: getErrorMessage(error), variant: 'destructive' }),
  })

  const onGenerate = async () => {
    const ok = await confirm({
      title: `Générer les factures de ${month} ?`,
      description:
        'Les factures manquantes du mois sont créées avec un numéro définitif (séquence sans trou). Les créateurs déjà facturés pour ce mois sont ignorés.',
      confirmText: 'Générer',
    })
    if (ok) generate.mutate()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Fiscalité</h1>
        <p className="mt-2 text-muted-foreground">Déclaration DAC7 des revenus des créateurs et factures d’autofacturation.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <FileSpreadsheet className="h-5 w-5" />
            Déclaration DAC7
          </CardTitle>
          <CardDescription>
            Un enregistrement par vendeur ayant au moins une vente payée dans l’année : identité, compte bancaire et, par
            trimestre, contrepartie versée (part créateur), nombre d’activités et commissions prélevées.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              La déclaration officielle est déposée auprès de la DGFiP au format XML (DPI-DAC7), via l’espace professionnel
              ou en EDI, au plus tard le 31 janvier de l’année suivante. Cet export en est la source (ou est transmis au
              comptable). Il contient les IBAN complets : chaque consultation est journalisée.
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dac7-year">Année</Label>
              <select
                id="dac7-year"
                className={selectClass}
                value={year}
                onChange={(event) => {
                  setYear(Number(event.target.value))
                  setReport(null)
                }}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                    {y === currentYear ? ' (en cours)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending}>
              {preview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Aperçu
            </Button>
            <Button onClick={() => download.mutate()} disabled={download.isPending}>
              {download.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Télécharger le CSV
            </Button>
          </div>

          {report && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary">{report.sellers} vendeur(s) déclarable(s)</Badge>
                {report.incompleteProfiles > 0 ? (
                  <Badge variant="destructive">{report.incompleteProfiles} profil(s) fiscal(aux) incomplet(s)</Badge>
                ) : (
                  <Badge variant="outline">Tous les profils sont complets</Badge>
                )}
              </div>
              {report.records.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun vendeur déclarable pour {report.year}.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Vendeur</th>
                        <th className="px-3 py-2 font-medium">Pays</th>
                        <th className="px-3 py-2 text-right font-medium">Contrepartie</th>
                        <th className="px-3 py-2 text-right font-medium">Activités</th>
                        <th className="px-3 py-2 text-right font-medium">Commissions</th>
                        <th className="px-3 py-2 font-medium">Profil</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {report.records.map((record) => {
                        const name =
                          record.entityType === 'company'
                            ? record.companyName
                            : [record.firstName, record.lastName].filter(Boolean).join(' ')
                        return (
                          <tr key={record.creatorId}>
                            <td className="px-3 py-2">
                              <p className="font-medium">{name || '—'}</p>
                              <p className="text-xs text-muted-foreground">@{record.username}</p>
                            </td>
                            <td className="px-3 py-2">{countryLabel(record.country) || '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatEuros(record.total.consideration)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{record.total.activities}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatEuros(record.total.fees)}</td>
                            <td className="px-3 py-2">
                              {record.profileComplete ? (
                                <Badge variant="outline">Complet</Badge>
                              ) : (
                                <span title={record.missingFields.map((f) => TAX_FIELD_LABELS[f] ?? f).join(', ')}>
                                  <Badge variant="destructive">Incomplet ({record.missingFields.length})</Badge>
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Généré le {formatDateTime(report.generatedAt)}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Receipt className="h-5 w-5" />
            Factures d’autofacturation
          </CardTitle>
          <CardDescription>
            Générées automatiquement le 1er de chaque mois pour le mois précédent. Utilisez ce bouton pour rattraper un mois
            manqué : l’opération est idempotente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-month">Mois</Label>
              <Input
                id="invoice-month"
                type="month"
                value={month}
                max={previousMonthValue()}
                onChange={(event) => {
                  setMonth(event.target.value)
                  setGeneration(null)
                }}
                className="w-48"
              />
            </div>
            <Button onClick={onGenerate} disabled={!validMonth || generate.isPending}>
              {generate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Générer les factures manquantes
            </Button>
          </div>

          {generation && (
            <p className="text-sm">
              {generation.period} : <strong>{generation.created}</strong> créée(s), {generation.skipped} ignorée(s)
              {generation.failed > 0 && <span className="text-destructive">, {generation.failed} en échec (voir les journaux)</span>}
              .
            </p>
          )}

          {invoices.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : invoices.isError ? (
            <p className="text-sm text-destructive">{getErrorMessage(invoices.error)}</p>
          ) : !invoices.data?.length ? (
            <p className="text-sm text-muted-foreground">Aucune facture pour ce mois.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Numéro</th>
                    <th className="px-3 py-2 font-medium">Créateur</th>
                    <th className="px-3 py-2 text-right font-medium">HT</th>
                    <th className="px-3 py-2 text-right font-medium">TVA</th>
                    <th className="px-3 py-2 text-right font-medium">TTC</th>
                    <th className="px-3 py-2 font-medium">Émise le</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.data.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="px-3 py-2 font-mono text-xs">{invoice.number}</td>
                      <td className="px-3 py-2">{invoice.creator.displayName || invoice.creator.username}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatEuros(invoice.netAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatEuros(invoice.vatAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatEuros(invoice.totalAmount)}</td>
                      <td className="px-3 py-2">{formatDateTime(invoice.issuedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
