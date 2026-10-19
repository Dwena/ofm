'use client'

import { useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { paymentsApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Download,
  Gift,
  Loader2,
  Lock,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Wallet,
  X,
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useDebounce } from '@/hooks/use-debounce'
import { toast } from '@/hooks/use-toast'
import { formatDateTime, formatEuros } from '@/lib/utils'

type TransactionType = 'SUBSCRIPTION' | 'TIP' | 'PPV_UNLOCK' | 'PAYOUT' | 'REFUND' | 'PLATFORM_FEE'
type TransactionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'DISPUTED'

interface Party {
  id: string
  username: string
  displayName?: string | null
  avatar?: string | null
}

interface Transaction {
  id: string
  type: TransactionType
  status: TransactionStatus
  amount: number // euros
  currency: string
  platformFee: number
  netAmount: number
  fromUserId: string
  toUserId?: string | null
  contentId?: string | null
  metadata?: Record<string, any> | null
  failureReason?: string | null
  createdAt: string
  fromUser?: Party | null
  toUser?: Party | null
}

interface TransactionsResponse {
  items: Transaction[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  summary?: { totalSpent: number; totalRefunded: number; totalReceived: number }
}

const TYPE_CONFIG: Record<TransactionType, { label: string; icon: typeof CreditCard; color: string }> = {
  SUBSCRIPTION: { label: 'Abonnement', icon: CreditCard, color: 'bg-blue-100 text-blue-700' },
  TIP: { label: 'Pourboire', icon: Gift, color: 'bg-green-100 text-green-700' },
  PPV_UNLOCK: { label: 'Achat à l’unité', icon: Lock, color: 'bg-purple-100 text-purple-700' },
  PAYOUT: { label: 'Retrait', icon: Wallet, color: 'bg-orange-100 text-orange-700' },
  REFUND: { label: 'Remboursement', icon: RotateCcw, color: 'bg-red-100 text-red-700' },
  PLATFORM_FEE: { label: 'Frais', icon: Receipt, color: 'bg-gray-100 text-gray-700' },
}

const STATUS_CONFIG: Record<
  TransactionStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' }
> = {
  PENDING: { label: 'En attente', variant: 'secondary' },
  PROCESSING: { label: 'En cours', variant: 'secondary' },
  COMPLETED: { label: 'Effectué', variant: 'success' },
  FAILED: { label: 'Échoué', variant: 'destructive' },
  CANCELLED: { label: 'Annulé', variant: 'outline' },
  REFUNDED: { label: 'Remboursé', variant: 'outline' },
  PARTIALLY_REFUNDED: { label: 'Remboursé en partie', variant: 'outline' },
  DISPUTED: { label: 'Litige en cours', variant: 'destructive' },
}

// Fan-side filters; payouts and fees belong to /creator/earnings
const TYPE_FILTERS: TransactionType[] = ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK', 'REFUND']
const STATUS_FILTERS: TransactionStatus[] = ['COMPLETED', 'PENDING', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED']

const PAGE_SIZE = 20
const ALL = 'all'

interface Filters {
  type: string
  status: string
  direction: string
  search: string
  startDate: string
  endDate: string
}

const EMPTY_FILTERS: Filters = { type: ALL, status: ALL, direction: ALL, search: '', startDate: '', endDate: '' }

const toParams = (filters: Filters, page: number, limit: number) => ({
  page,
  limit,
  ...(filters.type !== ALL && { type: filters.type }),
  ...(filters.status !== ALL && { status: filters.status }),
  ...(filters.direction !== ALL && { direction: filters.direction }),
  ...(filters.search.trim() && { search: filters.search.trim() }),
  ...(filters.startDate && { startDate: filters.startDate }),
  ...(filters.endDate && { endDate: filters.endDate }),
})

const partyName = (party?: Party | null) => (party ? party.displayName || party.username : null)

const WHO = '{who}'

/**
 * What the transaction was for, in French (the API has no description
 * column); `{who}` stands for the other party
 */
function describe(transaction: Transaction, outgoing: boolean) {
  const meta = transaction.metadata ?? {}

  switch (transaction.type) {
    case 'SUBSCRIPTION':
      return meta.kind === 'NEW_SUBSCRIBER'
        ? `Nouvel abonnement ${outgoing ? 'à' : 'de'} ${WHO}`
        : `Renouvellement d’abonnement ${outgoing ? 'à' : 'de'} ${WHO}`
    case 'TIP':
      return `Pourboire ${outgoing ? 'à' : 'de'} ${WHO}${meta.streamId ? ' pendant un live' : ''}`
    case 'PPV_UNLOCK':
      if (meta.streamId) return outgoing ? `Accès au live de ${WHO}` : `Accès à votre live acheté par ${WHO}`
      return outgoing ? `Contenu à l’unité de ${WHO}` : `Contenu acheté par ${WHO}`
    case 'REFUND':
      return outgoing ? `Remboursement à ${WHO}` : `Remboursement de ${WHO}`
    case 'PAYOUT':
      return 'Retrait vers votre compte bancaire'
    default:
      return TYPE_CONFIG[transaction.type]?.label ?? transaction.type
  }
}

const otherParty = (transaction: Transaction, outgoing: boolean) =>
  outgoing ? transaction.toUser : transaction.fromUser

const describeText = (transaction: Transaction, outgoing: boolean) => {
  const other = otherParty(transaction, outgoing)
  return describe(transaction, outgoing).replace(WHO, other ? `@${other.username}` : 'un utilisateur')
}

/** Link to what was bought, when it still makes sense */
function itemLink(transaction: Transaction) {
  const meta = transaction.metadata ?? {}
  if (transaction.type === 'PPV_UNLOCK') {
    if (meta.streamId) return { href: `/live/${meta.streamId}`, label: 'Voir le live' }
    const contentId = transaction.contentId || meta.contentId
    if (contentId) return { href: `/content/${contentId}`, label: 'Voir le contenu' }
  }
  return null
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`

export default function PaymentsPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [exporting, setExporting] = useState(false)
  const debouncedSearch = useDebounce(filters.search, 300)
  const queryFilters = { ...filters, search: debouncedSearch }

  const invalidRange = !!filters.startDate && !!filters.endDate && filters.startDate > filters.endDate

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['transactions', 'history', page, queryFilters],
    queryFn: async () =>
      (await paymentsApi.getFilteredTransactions(toParams(queryFilters, page, PAGE_SIZE))).data as TransactionsResponse,
    placeholderData: keepPreviousData,
    enabled: !invalidRange,
  })

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
  }

  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)
  const transactions = data?.items ?? []
  const pagination = data?.pagination
  const summary = data?.summary
  const isOutgoing = (transaction: Transaction) => transaction.fromUserId === user?.id

  const handleExport = async () => {
    setExporting(true)
    try {
      const rows: Transaction[] = []
      for (let current = 1; current <= 50; current++) {
        const response = await paymentsApi.getFilteredTransactions(toParams(queryFilters, current, 100))
        const result = response.data as TransactionsResponse
        rows.push(...result.items)
        if (current >= result.pagination.totalPages) break
      }

      const header = ['Date', 'Type', 'Description', 'Statut', 'Montant (EUR)']
      const lines = rows.map((transaction) => {
        const outgoing = isOutgoing(transaction)
        const amount = outgoing ? -transaction.amount : transaction.type === 'REFUND' ? transaction.amount : transaction.netAmount
        return [
          new Date(transaction.createdAt).toISOString(),
          TYPE_CONFIG[transaction.type]?.label ?? transaction.type,
          describeText(transaction, outgoing),
          STATUS_CONFIG[transaction.status]?.label ?? transaction.status,
          amount.toFixed(2),
        ]
          .map(csvCell)
          .join(';')
      })

      const blob = new Blob([`﻿${[header.map(csvCell).join(';'), ...lines].join('\n')}`], {
        type: 'text/csv;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `paiements-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: 'Export impossible', description: 'Veuillez réessayer.', variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Historique des paiements</h1>
          <p className="text-muted-foreground mt-2">
            Vos abonnements, pourboires, achats et remboursements
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/payment-methods">
              <CreditCard className="h-4 w-4 mr-2" />
              Moyens de paiement
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/subscriptions">Mes abonnements</Link>
          </Button>
        </div>
      </div>

      {/* Summary (all-time, whatever the filters) */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <SummaryCard
          title="Dépensé"
          value={summary ? `-${formatEuros(summary.totalSpent)}` : '—'}
          hint="Total payé aux créateurs"
          icon={<ArrowUpRight className="h-4 w-4 text-red-600" />}
          className="text-red-600"
        />
        <SummaryCard
          title="Remboursé"
          value={summary ? `+${formatEuros(summary.totalRefunded)}` : '—'}
          hint="Remboursements reçus"
          icon={<RotateCcw className="h-4 w-4 text-muted-foreground" />}
        />
        {summary && summary.totalReceived > 0 ? (
          <SummaryCard
            title="Reçu"
            value={`+${formatEuros(summary.totalReceived)}`}
            hint="Revenus nets en tant que créateur"
            icon={<ArrowDownLeft className="h-4 w-4 text-green-600" />}
            className="text-green-600"
          />
        ) : (
          <SummaryCard
            title="Transactions"
            value={pagination ? String(pagination.total) : '—'}
            hint={hasFilters ? 'Correspondant aux filtres' : 'Au total'}
            icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Transactions</CardTitle>
              <CardDescription>
                {pagination ? `${pagination.total} transaction${pagination.total > 1 ? 's' : ''}` : 'Chargement...'}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
                Actualiser
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting || !pagination?.total || invalidRange}
              >
                {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                Exporter (CSV)
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="relative sm:col-span-2 lg:col-span-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un créateur..."
                className="pl-9"
                value={filters.search}
                maxLength={100}
                onChange={(e) => updateFilter('search', e.target.value)}
              />
            </div>
            <Select value={filters.type} onValueChange={(value) => updateFilter('type', value)}>
              <SelectTrigger aria-label="Type">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les types</SelectItem>
                {TYPE_FILTERS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {TYPE_CONFIG[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(value) => updateFilter('status', value)}>
              <SelectTrigger aria-label="Statut">
                <SelectValue placeholder="Statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les statuts</SelectItem>
                {STATUS_FILTERS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_CONFIG[status].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.direction} onValueChange={(value) => updateFilter('direction', value)}>
              <SelectTrigger aria-label="Sens">
                <SelectValue placeholder="Sens" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Envoyés et reçus</SelectItem>
                <SelectItem value="sent">Paiements envoyés</SelectItem>
                <SelectItem value="received">Reçus (remboursements, revenus)</SelectItem>
              </SelectContent>
            </Select>
            <div className="space-y-1">
              <Label htmlFor="start-date" className="text-xs text-muted-foreground">
                Du
              </Label>
              <Input
                id="start-date"
                type="date"
                value={filters.startDate}
                max={filters.endDate || undefined}
                onChange={(e) => updateFilter('startDate', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end-date" className="text-xs text-muted-foreground">
                Au
              </Label>
              <Input
                id="end-date"
                type="date"
                value={filters.endDate}
                min={filters.startDate || undefined}
                onChange={(e) => updateFilter('endDate', e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost"
                className="w-full"
                disabled={!hasFilters}
                onClick={() => {
                  setFilters(EMPTY_FILTERS)
                  setPage(1)
                }}
              >
                <X className="h-4 w-4 mr-2" />
                Réinitialiser
              </Button>
            </div>
          </div>
          {invalidRange && (
            <p className="text-sm text-destructive">La date de début doit précéder la date de fin.</p>
          )}

          {/* Transaction List */}
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="text-center py-12 space-y-4">
              <p className="text-muted-foreground">Impossible de charger vos transactions.</p>
              <Button variant="outline" onClick={() => refetch()}>
                Réessayer
              </Button>
            </div>
          ) : transactions.length > 0 ? (
            <div className={`space-y-2 ${isFetching ? 'opacity-60' : ''}`}>
              {transactions.map((transaction) => (
                <TransactionRow key={transaction.id} transaction={transaction} outgoing={isOutgoing(transaction)} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Receipt className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">
                {hasFilters ? 'Aucune transaction ne correspond à ces filtres' : 'Aucune transaction pour le moment'}
              </p>
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} sur {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-none"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isFetching}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-none"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= pagination.totalPages || isFetching}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({
  title,
  value,
  hint,
  icon,
  className = '',
}: {
  title: string
  value: string
  hint: string
  icon: React.ReactNode
  className?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${className}`}>{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </CardContent>
    </Card>
  )
}

function TransactionRow({ transaction, outgoing }: { transaction: Transaction; outgoing: boolean }) {
  const config = TYPE_CONFIG[transaction.type] ?? TYPE_CONFIG.PLATFORM_FEE
  const status = STATUS_CONFIG[transaction.status] ?? { label: transaction.status, variant: 'outline' as const }
  const Icon = config.icon
  const meta = transaction.metadata ?? {}
  const other = otherParty(transaction, outgoing)
  const link = itemLink(transaction)
  const settled = !['FAILED', 'CANCELLED'].includes(transaction.status)
  // Creators receive the amount net of the platform fee; refunds are received in full
  const shown = outgoing || transaction.type === 'REFUND' ? transaction.amount : transaction.netAmount
  const refundAmount = Number(meta.refundAmount ?? (transaction.status === 'REFUNDED' ? transaction.amount : 0))
  const refunded = transaction.status === 'REFUNDED' || transaction.status === 'PARTIALLY_REFUNDED'

  return (
    <div className="flex flex-col gap-3 p-4 border rounded-lg sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center ${config.color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{config.label}</p>
            <span className="text-xs text-muted-foreground">{formatDateTime(transaction.createdAt)}</span>
          </div>
          <p className="text-sm text-muted-foreground break-words">
            {describe(transaction, outgoing)
              .split(WHO)
              .map((part, index) => (
                <span key={index}>
                  {index > 0 &&
                    (other ? (
                      <Link href={`/${other.username}`} className="font-medium text-foreground hover:underline">
                        {partyName(other)}
                      </Link>
                    ) : (
                      'un utilisateur'
                    ))}
                  {part}
                </span>
              ))}
          </p>
          {transaction.type === 'TIP' && meta.message && (
            <p className="text-sm italic text-muted-foreground break-words">« {meta.message} »</p>
          )}
          {refunded && (
            <p className="text-xs text-muted-foreground">
              {transaction.status === 'PARTIALLY_REFUNDED' ? 'Remboursé en partie' : 'Remboursé'}
              {refundAmount > 0 && ` : ${formatEuros(refundAmount)}`}
              {meta.refundedAt && ` le ${new Date(meta.refundedAt).toLocaleDateString('fr-FR')}`}
              {meta.refundReason && ` (${meta.refundReason})`}
            </p>
          )}
          {transaction.type === 'REFUND' && meta.reason && (
            <p className="text-xs text-muted-foreground">Motif : {meta.reason}</p>
          )}
          {transaction.status === 'FAILED' && (
            <p className="text-xs text-destructive">
              Paiement refusé{transaction.failureReason ? ` : ${transaction.failureReason}` : ''}
            </p>
          )}
          {link && settled && (
            <Link href={link.href} className="text-xs text-primary hover:underline">
              {link.label}
            </Link>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
        <p
          className={`text-lg font-bold whitespace-nowrap ${
            !settled ? 'line-through text-muted-foreground' : outgoing ? '' : 'text-green-600'
          }`}
        >
          {outgoing ? '-' : '+'}
          {formatEuros(shown)}
        </p>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
    </div>
  )
}
