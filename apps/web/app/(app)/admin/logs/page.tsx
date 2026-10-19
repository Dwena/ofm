'use client'

import { useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useDebounce } from '@/hooks/use-debounce'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Paginated,
  PaginationControls,
  formatDateTime,
  ACTION_LABELS,
} from '@/components/admin/admin-shared'

interface AuditLog {
  id: string
  action: string
  resource: string
  resourceId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  actor: { id: string; username: string; displayName?: string | null } | null
}

const RESOURCES: Record<string, string> = {
  USER: 'Utilisateurs',
  CONTENT: 'Contenus',
  REPORT: 'Signalements',
  SETTINGS: 'Paramètres',
}

function summarize(metadata: AuditLog['metadata']) {
  if (!metadata) return ''
  const changes = metadata.changes as Record<string, { from: unknown; to: unknown }> | undefined
  if (changes) {
    return Object.entries(changes)
      .map(([key, change]) => `${key} : ${String(change.from)} → ${String(change.to)}`)
      .join(' • ')
  }
  const parts = [metadata.reason, metadata.notes, metadata.details].filter(Boolean)
  return parts.map(String).join(' • ')
}

export default function AdminLogsPage() {
  const [action, setAction] = useState('')
  const [resource, setResource] = useState('all')
  const [page, setPage] = useState(1)
  const debouncedAction = useDebounce(action, 400)

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-audit-logs', debouncedAction, resource, page],
    queryFn: async () => {
      const response = await adminApi.getAuditLogs({
        action: debouncedAction.trim() || undefined,
        resource: resource !== 'all' ? resource : undefined,
        page,
        limit: 50,
      })
      return response.data as Paginated<AuditLog>
    },
    placeholderData: keepPreviousData,
  })

  const logs = data?.items ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ScrollText className="h-7 w-7" />
          Journaux d&apos;audit
        </h1>
        <p className="text-muted-foreground mt-1">Historique des actions d&apos;administration et de modération</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Actions</CardTitle>
              <CardDescription>
                {data?.pagination.total ?? 0} entrée(s){isFetching && !isLoading ? ' • mise à jour...' : ''}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Filtrer par action (ex. BAN, KYC)"
                aria-label="Filtrer par action"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value)
                  setPage(1)
                }}
                className="sm:w-56"
              />
              <Select
                value={resource}
                onValueChange={(value) => {
                  setResource(value)
                  setPage(1)
                }}
              >
                <SelectTrigger className="sm:w-44" aria-label="Ressource">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les ressources</SelectItem>
                  {Object.entries(RESOURCES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} label="Impossible de charger le journal" />
          ) : logs.length === 0 ? (
            <EmptyState>Aucune action enregistrée</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Ressource</TableHead>
                    <TableHead>Auteur</TableHead>
                    <TableHead>Détails</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ACTION_LABELS[log.action] || log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {RESOURCES[log.resource] || log.resource}
                        {log.resourceId &&
                          (log.resource === 'USER' ? (
                            <Link
                              href={`/admin/users?user=${log.resourceId}`}
                              className="text-xs text-primary hover:underline"
                            >
                              {' '}• {log.resourceId.slice(0, 8)}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground"> • {log.resourceId.slice(0, 8)}</span>
                          ))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {log.actor ? (
                          <Link href={`/admin/users?user=${log.actor.id}`} className="hover:underline">
                            @{log.actor.username}
                          </Link>
                        ) : (
                          'Système'
                        )}
                      </TableCell>
                      <TableCell className="max-w-md text-sm text-muted-foreground break-words">
                        {summarize(log.metadata)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <PaginationControls pagination={data?.pagination} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  )
}
