'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminPayoutsApi } from '@/lib/api'
import { formatDateTime, formatEuros } from '@/lib/utils'
import { getPaymentErrorMessage } from '@/lib/payment-errors'
import { toast } from '@/hooks/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Download, Info, Loader2 } from 'lucide-react'

type PayoutStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

interface AdminPayout {
  id: string
  amount: number
  status: PayoutStatus
  destination: string | null
  reference: string | null
  failureReason: string | null
  createdAt: string
  paidAt: string | null
  creator: { id: string; username: string; displayName: string | null; email: string }
  batch: { id: string; reference: string } | null
}

const STATUS_LABELS: Record<PayoutStatus, string> = {
  PENDING: 'À exporter',
  PROCESSING: 'Exporté (en attente de la banque)',
  COMPLETED: 'Payé',
  FAILED: 'Rejeté',
  CANCELLED: 'Annulé',
}

const FILTERS: (PayoutStatus | 'ALL')[] = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'ALL']

/** Download a text file built in the browser */
function download(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Creator payouts: export the pending ones as a SEPA credit transfer file to
 * upload to the bank, then mark them paid (or rejected: back on the balance)
 */
export default function AdminPayoutsPage() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<PayoutStatus | 'ALL'>('PENDING')

  const { data: payouts, isLoading } = useQuery<AdminPayout[]>({
    queryKey: ['admin-payouts', filter],
    queryFn: async () => (await adminPayoutsApi.list(filter === 'ALL' ? undefined : filter)).data,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-payouts'] })
  const onError = (error: any) =>
    toast({ title: 'Erreur', description: getPaymentErrorMessage(error, 'Action impossible'), variant: 'destructive' })

  const batchMutation = useMutation({
    mutationFn: async () => (await adminPayoutsApi.createBatch()).data,
    onSuccess: (data: { fileName: string; xml: string; batch: { payoutCount: number; totalAmount: number }; skipped: { payoutId: string; reason: string }[] }) => {
      download(data.fileName, data.xml, 'application/xml')
      toast({
        title: 'Fichier SEPA généré',
        description: `${data.batch.payoutCount} virement(s), ${formatEuros(data.batch.totalAmount)}. Déposez-le dans votre espace bancaire.${
          data.skipped.length ? ` ${data.skipped.length} virement(s) ignoré(s) : coordonnées bancaires manquantes.` : ''
        }`,
      })
      refresh()
    },
    onError,
  })

  const paidMutation = useMutation({
    mutationFn: (id: string) => adminPayoutsApi.markPaid(id),
    onSuccess: () => {
      toast({ title: 'Virement marqué comme payé' })
      refresh()
    },
    onError,
  })

  const failMutation = useMutation({
    mutationFn: ({ id, reason, cancel }: { id: string; reason: string; cancel: boolean }) =>
      cancel ? adminPayoutsApi.cancel(id, reason) : adminPayoutsApi.markFailed(id, reason),
    onSuccess: () => {
      toast({ title: 'Montant recrédité sur le solde du créateur' })
      refresh()
    },
    onError,
  })

  const askReason = (payout: AdminPayout, cancel: boolean) => {
    const reason = window.prompt(cancel ? 'Motif de l’annulation' : 'Motif du rejet (ex. IBAN invalide, compte clos)')
    if (reason?.trim()) failMutation.mutate({ id: payout.id, reason: reason.trim(), cancel })
  }

  const pendingTotal = (payouts ?? []).filter((p) => p.status === 'PENDING').reduce((sum, p) => sum + p.amount, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Virements créateurs</h1>
        <p className="text-muted-foreground">Reversement des gains par virement SEPA depuis le compte de la plateforme</p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          1. Générez le fichier SEPA des virements à exporter. 2. Déposez-le dans l’espace professionnel de votre banque
          (virements groupés). 3. Une fois exécutés, marquez-les « payés » ; un virement rejeté par la banque est remis
          sur le solde du créateur.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Virements</CardTitle>
            <CardDescription>
              {filter === 'PENDING' ? `${formatEuros(pendingTotal)} à exporter` : STATUS_LABELS[filter as PayoutStatus] ?? 'Tous'}
            </CardDescription>
          </div>
          <Button onClick={() => batchMutation.mutate()} disabled={batchMutation.isPending}>
            {batchMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Générer le fichier SEPA
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((value) => (
              <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>
                {value === 'ALL' ? 'Tous' : STATUS_LABELS[value]}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          ) : !payouts?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">Aucun virement</p>
          ) : (
            <div className="divide-y">
              {payouts.map((payout) => (
                <div key={payout.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {formatEuros(payout.amount)} · {payout.creator.displayName || payout.creator.username}{' '}
                      <span className="text-muted-foreground font-normal">@{payout.creator.username}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(payout.createdAt)}
                      {payout.destination && ` · IBAN •••• ${payout.destination}`}
                      {payout.batch && ` · Lot ${payout.batch.reference}`}
                      {payout.failureReason && ` · ${payout.failureReason}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline">{STATUS_LABELS[payout.status]}</Badge>
                    {payout.status === 'PENDING' && (
                      <Button size="sm" variant="ghost" onClick={() => askReason(payout, true)}>
                        Annuler
                      </Button>
                    )}
                    {payout.status === 'PROCESSING' && (
                      <>
                        <Button size="sm" onClick={() => paidMutation.mutate(payout.id)} disabled={paidMutation.isPending}>
                          Payé
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => askReason(payout, false)}>
                          Rejeté
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
