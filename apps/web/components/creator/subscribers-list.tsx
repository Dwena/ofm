'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuros } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertCircle, Loader2, MessageSquare, Search, Users } from 'lucide-react'
import type { CreatorTier } from './tier-manager'

export interface CreatorSubscription {
  id: string
  subscriberId: string
  status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE' | 'PAUSED'
  cancelAtPeriodEnd: boolean
  cancelledAt: string | null
  currentPeriodEnd: string
  createdAt: string
  totalSpent: number
  subscriber: { id: string; username: string; displayName: string | null; avatar: string | null }
  tier: { id: string; name: string; price: number; interval: string }
  pendingTier?: { id: string; name: string } | null
}

type StatusFilter = 'all' | 'ACTIVE' | 'ENDING' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'PAUSED'

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Tous les statuts' },
  { value: 'ACTIVE', label: 'Actifs' },
  { value: 'ENDING', label: 'Résiliation prévue' },
  { value: 'PAST_DUE', label: 'Paiement en retard' },
  { value: 'CANCELLED', label: 'Annulés' },
  { value: 'EXPIRED', label: 'Expirés' },
  { value: 'PAUSED', label: 'En pause' },
]

function statusBadge(sub: CreatorSubscription) {
  if (sub.status === 'ACTIVE' && sub.cancelAtPeriodEnd) {
    return <Badge variant="outline" className="border-amber-500 text-amber-600">Résiliation prévue</Badge>
  }
  switch (sub.status) {
    case 'ACTIVE':
      return <Badge variant="success">Actif</Badge>
    case 'PAST_DUE':
      return <Badge variant="destructive">Paiement en retard</Badge>
    case 'PAUSED':
      return <Badge variant="secondary">En pause</Badge>
    case 'EXPIRED':
      return <Badge variant="secondary">Expiré</Badge>
    default:
      return <Badge variant="secondary">Annulé</Badge>
  }
}

function matchesStatus(sub: CreatorSubscription, filter: StatusFilter) {
  if (filter === 'all') return true
  if (filter === 'ENDING') return sub.status === 'ACTIVE' && sub.cancelAtPeriodEnd
  return sub.status === filter
}

const formatDate = (date: string | null) =>
  date ? new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function renewalLabel(sub: CreatorSubscription) {
  if (sub.status === 'CANCELLED' || sub.status === 'EXPIRED') {
    return { label: 'Terminé le', date: formatDate(sub.cancelledAt || sub.currentPeriodEnd) }
  }
  if (sub.cancelAtPeriodEnd) return { label: 'Se termine le', date: formatDate(sub.currentPeriodEnd) }
  if (Number(sub.tier.price) === 0) return { label: 'Renouvellement', date: 'Gratuit' }
  return { label: 'Renouvellement', date: formatDate(sub.currentPeriodEnd) }
}

interface SubscribersListProps {
  subscriptions: CreatorSubscription[] | undefined
  tiers: CreatorTier[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

export function SubscribersList({ subscriptions, tiers, isLoading, isError, onRetry }: SubscribersListProps) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('ACTIVE')
  const [tierId, setTierId] = useState('all')

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (subscriptions || []).filter((sub) => {
      if (!matchesStatus(sub, status)) return false
      if (tierId !== 'all' && sub.tier.id !== tierId) return false
      if (!query) return true
      return (
        sub.subscriber.username.toLowerCase().includes(query) ||
        (sub.subscriber.displayName || '').toLowerCase().includes(query)
      )
    })
  }, [subscriptions, search, status, tierId])

  const hasFilters = search.trim() !== '' || status !== 'all' || tierId !== 'all'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Liste des abonnés</CardTitle>
        <CardDescription>
          {subscriptions
            ? `${filtered.length} abonnement${filtered.length > 1 ? 's' : ''} affiché${filtered.length > 1 ? 's' : ''} sur ${subscriptions.length}`
            : 'Vos abonnés et leur historique'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_200px_200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher un abonné..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Rechercher un abonné"
            />
          </div>
          <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
            <SelectTrigger aria-label="Filtrer par statut">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusFilters.map((filter) => (
                <SelectItem key={filter.value} value={filter.value}>
                  {filter.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={tierId} onValueChange={setTierId}>
            <SelectTrigger aria-label="Filtrer par offre">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les offres</SelectItem>
              {tiers.map((tier) => (
                <SelectItem key={tier.id} value={tier.id}>
                  {tier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">Impossible de charger vos abonnés.</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Réessayer
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            {subscriptions && subscriptions.length > 0 ? (
              <>
                <p>Aucun abonné ne correspond à ces filtres</p>
                {hasFilters && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setStatus('all')
                      setTierId('all')
                    }}
                  >
                    Réinitialiser les filtres
                  </Button>
                )}
              </>
            ) : (
              <p>Aucun abonné pour le moment</p>
            )}
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {filtered.map((sub) => {
              const name = sub.subscriber.displayName || sub.subscriber.username
              const renewal = renewalLabel(sub)
              return (
                <li
                  key={sub.id}
                  className="flex flex-col gap-3 p-4 lg:grid lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] lg:items-center lg:gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar>
                      <AvatarImage src={sub.subscriber.avatar || undefined} alt={name} />
                      <AvatarFallback>{name.substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{name}</p>
                      <p className="text-sm text-muted-foreground truncate">@{sub.subscriber.username}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:contents">
                    <div>
                      <p className="text-xs text-muted-foreground">Offre</p>
                      <p className="font-medium truncate">{sub.tier.name}</p>
                      {sub.pendingTier && (
                        <p className="text-xs text-muted-foreground truncate">→ {sub.pendingTier.name}</p>
                      )}
                      <div className="mt-1">{statusBadge(sub)}</div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Abonné depuis</p>
                      <p>{formatDate(sub.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{renewal.label}</p>
                      <p>{renewal.date}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total dépensé</p>
                      <p className="font-semibold">{formatEuros(sub.totalSpent)}</p>
                    </div>
                  </div>

                  <Button variant="outline" size="sm" asChild className="w-full lg:w-auto">
                    <Link href={`/messages?user=${encodeURIComponent(sub.subscriber.username)}`}>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Message
                    </Link>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
