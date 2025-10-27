'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { paymentsApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  CreditCard,
  ArrowUpRight,
  ArrowDownLeft,
  DollarSign,
  Calendar,
  Filter,
  Download,
  RefreshCw
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { formatCurrency, formatDateTime } from '@/lib/utils'

type TransactionType = 'SUBSCRIPTION' | 'TIP' | 'PPV' | 'PAYOUT' | 'REFUND' | 'PLATFORM_FEE'
type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED'

interface Transaction {
  id: string
  type: TransactionType
  amount: number
  currency: string
  status: TransactionStatus
  description: string
  createdAt: string
  fromUser?: {
    username: string
    displayName?: string
  }
  toUser?: {
    username: string
    displayName?: string
  }
  platformFee?: number
  netAmount?: number
}

export default function PaymentsPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Fetch transactions
  const { data: transactionsData, isLoading, refetch } = useQuery({
    queryKey: ['transactions', page, typeFilter, statusFilter],
    queryFn: async () => {
      const response = await paymentsApi.getTransactions(page, 20)
      return response.data
    },
  })

  const transactions = transactionsData?.data || []
  const pagination = transactionsData?.pagination

  // Calculate summary stats
  const totalReceived = transactions
    .filter((t: Transaction) => t.toUser?.username === user?.username && t.status === 'COMPLETED')
    .reduce((sum: number, t: Transaction) => sum + Number(t.netAmount || t.amount), 0)

  const totalSent = transactions
    .filter((t: Transaction) => t.fromUser?.username === user?.username && t.status === 'COMPLETED')
    .reduce((sum: number, t: Transaction) => sum + Number(t.amount), 0)

  const typeColors: Record<TransactionType, string> = {
    SUBSCRIPTION: 'bg-blue-500',
    TIP: 'bg-green-500',
    PPV: 'bg-purple-500',
    PAYOUT: 'bg-orange-500',
    REFUND: 'bg-red-500',
    PLATFORM_FEE: 'bg-gray-500',
  }

  const statusColors: Record<TransactionStatus, string> = {
    PENDING: 'bg-yellow-500',
    COMPLETED: 'bg-green-500',
    FAILED: 'bg-red-500',
    REFUNDED: 'bg-gray-500',
  }

  const getTransactionIcon = (transaction: Transaction) => {
    if (transaction.toUser?.username === user?.username) {
      return <ArrowDownLeft className="h-4 w-4 text-green-600" />
    }
    return <ArrowUpRight className="h-4 w-4 text-red-600" />
  }

  const getTransactionAmount = (transaction: Transaction) => {
    const isReceived = transaction.toUser?.username === user?.username
    const amount = isReceived ? (transaction.netAmount || transaction.amount) : transaction.amount
    const sign = isReceived ? '+' : '-'
    return `${sign}${formatCurrency(Number(amount), transaction.currency)}`
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">Historique des Paiements</h1>
        <p className="text-muted-foreground mt-2">
          Consultez toutes vos transactions
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Reçu
            </CardTitle>
            <ArrowDownLeft className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              +{formatCurrency(totalReceived, 'EUR')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Montant total reçu
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Dépensé
            </CardTitle>
            <ArrowUpRight className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              -{formatCurrency(totalSent, 'EUR')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Montant total dépensé
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Transactions
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {pagination?.total || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Total de transactions
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transactions</CardTitle>
              <CardDescription>
                Liste de toutes vos transactions
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Actualiser
              </Button>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Exporter
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex gap-4">
            <div className="flex-1">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  <SelectItem value="SUBSCRIPTION">Abonnements</SelectItem>
                  <SelectItem value="TIP">Pourboires</SelectItem>
                  <SelectItem value="PPV">Pay-Per-View</SelectItem>
                  <SelectItem value="PAYOUT">Retraits</SelectItem>
                  <SelectItem value="REFUND">Remboursements</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="COMPLETED">Terminé</SelectItem>
                  <SelectItem value="PENDING">En attente</SelectItem>
                  <SelectItem value="FAILED">Échoué</SelectItem>
                  <SelectItem value="REFUNDED">Remboursé</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Transaction List */}
          <div className="space-y-2">
            {transactions.length > 0 ? (
              transactions.map((transaction: Transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      {getTransactionIcon(transaction)}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">
                          {transaction.description || transaction.type}
                        </p>
                        <Badge
                          variant="outline"
                          className={`text-xs ${typeColors[transaction.type]}`}
                        >
                          {transaction.type}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                        {transaction.fromUser && transaction.fromUser.username !== user?.username && (
                          <span>De: @{transaction.fromUser.username}</span>
                        )}
                        {transaction.toUser && transaction.toUser.username !== user?.username && (
                          <span>À: @{transaction.toUser.username}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDateTime(new Date(transaction.createdAt))}
                        </span>
                      </div>

                      {transaction.platformFee && transaction.platformFee > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Frais plateforme: {formatCurrency(Number(transaction.platformFee), transaction.currency)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p
                      className={`text-lg font-bold ${
                        transaction.toUser?.username === user?.username
                          ? 'text-green-600'
                          : 'text-red-600'
                      }`}
                    >
                      {getTransactionAmount(transaction)}
                    </p>
                    <Badge
                      variant="outline"
                      className={`text-xs ${statusColors[transaction.status]}`}
                    >
                      {transaction.status}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12">
                <CreditCard className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">
                  Aucune transaction pour le moment
                </p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} sur {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= pagination.totalPages}
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
