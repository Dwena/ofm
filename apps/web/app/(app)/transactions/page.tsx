'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { paymentsApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowUpCircle, ArrowDownCircle, CreditCard, Receipt, Filter, Search, Download } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const TRANSACTION_TYPES = {
  SUBSCRIPTION: { label: 'Abonnement', icon: CreditCard, color: 'bg-blue-100 text-blue-800' },
  TIP: { label: 'Pourboire', icon: ArrowUpCircle, color: 'bg-green-100 text-green-800' },
  PPV_UNLOCK: { label: 'PPV', icon: Receipt, color: 'bg-purple-100 text-purple-800' },
  PAYOUT: { label: 'Retrait', icon: ArrowDownCircle, color: 'bg-orange-100 text-orange-800' },
  REFUND: { label: 'Remboursement', icon: ArrowDownCircle, color: 'bg-red-100 text-red-800' },
  PLATFORM_FEE: { label: 'Frais', icon: CreditCard, color: 'bg-gray-100 text-gray-800' },
};

export default function TransactionsPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ type: '', search: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', page, filters],
    queryFn: async () => {
      const response = await paymentsApi.getTransactions(page, 20);
      return response.data;
    },
  });

  const formatAmount = (amount: number, type: string) => {
    const formatted = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
    return type === 'PAYOUT' || type === 'REFUND' || type === 'PLATFORM_FEE' ? `-${formatted}` : `+${formatted}`;
  };

  if (isLoading && page === 1) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container max-w-7xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Transactions</h1>
          <p className="text-muted-foreground mt-2">Historique complet de vos transactions</p>
        </div>
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Exporter
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher..."
                className="pl-9"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </div>
            <Select value={filters.type} onValueChange={(value) => setFilters({ ...filters, type: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Type de transaction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                {Object.entries(TRANSACTION_TYPES).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setFilters({ type: '', search: '' })}>
              <Filter className="h-4 w-4 mr-2" />
              Réinitialiser
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transactions List */}
      <Card>
        <CardHeader>
          <CardTitle>Liste des transactions</CardTitle>
          <CardDescription>
            {data?.total || 0} transaction(s) au total
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data?.items && data.items.length > 0 ? (
              data.items.map((transaction: any) => {
                const config = TRANSACTION_TYPES[transaction.type as keyof typeof TRANSACTION_TYPES];
                const Icon = config?.icon || Receipt;

                return (
                  <div key={transaction.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${config?.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium">{config?.label || transaction.type}</p>
                        <p className="text-sm text-muted-foreground">
                          {transaction.description || 'Transaction'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(transaction.createdAt), 'PPpp', { locale: fr })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${transaction.type === 'PAYOUT' || transaction.type === 'REFUND' ? 'text-red-600' : 'text-green-600'}`}>
                        {formatAmount(transaction.amount, transaction.type)}
                      </p>
                      <Badge variant={transaction.status === 'COMPLETED' ? 'default' : transaction.status === 'PENDING' ? 'secondary' : 'destructive'}>
                        {transaction.status}
                      </Badge>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12">
                <Receipt className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Aucune transaction trouvée</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {data?.totalPages && data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Précédent
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} sur {data.totalPages}
              </span>
              <Button
                variant="outline"
                onClick={() => setPage(p => p + 1)}
                disabled={page === data.totalPages}
              >
                Suivant
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
