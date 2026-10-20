'use client'

import { useState, type MutableRefObject } from 'react'
import type { Socket } from 'socket.io-client'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Check, ChevronDown, ListTodo, Loader2, SkipForward } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useToast } from '@/hooks/use-toast'
import { cn, formatEuros } from '@/lib/utils'
import { emitTipActionUpdate, TIP_ACTION_STATUS_LABELS, type TipAction } from '@/lib/live-tips'

interface TipActionsQueueProps {
  streamId: string
  socketRef: MutableRefObject<Socket | null | undefined>
  actions: TipAction[]
  /** Socket connected and broadcasting */
  connected: boolean
  /** Apply an updated action right away (the room also receives `tip-action-updated`) */
  onActionUpdated: (action: TipAction) => void
}

const ACK_ERRORS: Record<string, string> = {
  NOT_CREATOR: 'Seul le créateur du live peut traiter les demandes.',
  NOT_FOUND: 'Cette demande est introuvable.',
  TIMEOUT: 'Le serveur ne répond pas. Réessayez.',
}

/**
 * "Demandes à réaliser": requests paid from the tip menu, fed by the socket,
 * with "Fait" / "Ignorer" (creator)
 */
export function TipActionsQueue({ streamId, socketRef, actions, connected, onActionUpdated }: TipActionsQueueProps) {
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const pending = actions.filter((action) => action.status === 'PENDING')
  const history = actions
    .filter((action) => action.status !== 'PENDING')
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))

  const handleUpdate = async (action: TipAction, status: 'DONE' | 'SKIPPED') => {
    const socket = socketRef.current
    if (!socket || !connected) return
    setBusyId(action.id)
    const ack = await emitTipActionUpdate(socket, streamId, action.id, status)
    setBusyId(null)
    if (ack.success && ack.action) {
      onActionUpdated(ack.action)
      return
    }
    toast({
      title: 'Action impossible',
      description: ACK_ERRORS[ack.reason ?? ack.error ?? ''] || 'Réessayez.',
      variant: 'destructive',
    })
  }

  return (
    <Card data-testid="tip-actions-queue">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListTodo className="h-5 w-5" /> Demandes à réaliser
          {pending.length > 0 && <Badge className="bg-amber-500 hover:bg-amber-500">{pending.length}</Badge>}
        </CardTitle>
        <CardDescription>Les fans qui choisissent un palier du menu apparaissent ici, dans l’ordre.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune demande en attente pour le moment.</p>
        )}
        <ul className="space-y-2">
          {pending.map((action) => {
            const name = action.fromUser.displayName || action.fromUser.username
            const busy = busyId === action.id
            return (
              <li
                key={action.id}
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40"
                data-testid="tip-action-pending"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={action.fromUser.avatar || undefined} />
                    <AvatarFallback>{action.fromUser.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{action.label}</p>
                    <p className="text-xs text-muted-foreground break-words">
                      {name} · {formatEuros(action.amount)} · {format(new Date(action.createdAt), 'HH:mm', { locale: fr })}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleUpdate(action, 'DONE')}
                    disabled={!connected || busy}
                    aria-label={`Marquer « ${action.label} » de ${name} comme fait`}
                  >
                    {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                    Fait
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleUpdate(action, 'SKIPPED')}
                    disabled={!connected || busy}
                    aria-label={`Ignorer « ${action.label} » de ${name}`}
                  >
                    <SkipForward className="h-4 w-4 mr-1" /> Ignorer
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
        {history.length > 0 && (
          <div className="border-t pt-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setShowHistory((value) => !value)}
              aria-expanded={showHistory}
            >
              <span>Historique ({history.length})</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', showHistory && 'rotate-180')} />
            </button>
            {showHistory && (
              <ul className="mt-2 space-y-1.5">
                {history.map((action) => (
                  <li key={action.id} className="flex items-center justify-between gap-2 text-sm min-w-0">
                    <span className="min-w-0 truncate">
                      {action.label} · {action.fromUser.displayName || action.fromUser.username} ·{' '}
                      {formatEuros(action.amount)}
                    </span>
                    <Badge variant={action.status === 'DONE' ? 'secondary' : 'outline'} className="shrink-0">
                      {TIP_ACTION_STATUS_LABELS[action.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
