'use client'

import { memo } from 'react'
import { Gift, MicOff, MoreVertical, Trash2, Volume2 } from 'lucide-react'
import type { LiveChatMessage } from '@/lib/live'
import { cn, formatEuros } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface LiveChatMessageItemProps {
  message: LiveChatMessage
  /** Label of the creator badge ("Créateur" for viewers, "Vous" for the creator) */
  creatorLabel?: string
  /** The author is muted in the chat */
  muted?: boolean
  /** Moderation actions (creator only) */
  onDelete?: (message: LiveChatMessage) => void
  onToggleMute?: (message: LiveChatMessage) => void
}

/**
 * One line of a live chat: regular message, or a highlighted paid tip.
 * Memoized: a new message only renders that message (callbacks passed in
 * must be stable).
 */
export const LiveChatMessageItem = memo(function LiveChatMessageItem({
  message,
  creatorLabel = 'Créateur',
  muted = false,
  onDelete,
  onToggleMute,
}: LiveChatMessageItemProps) {
  const isTip = message.type === 'TIP'
  const name = message.displayName || message.username
  // Tips are not stored as chat messages and creators cannot be moderated
  const canModerate = !isTip && !message.isCreator && (onDelete || onToggleMute)

  return (
    <div
      className={cn(
        'group flex gap-2 rounded-lg',
        isTip && 'border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/40',
      )}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={message.avatar || undefined} />
        <AvatarFallback>{message.username.substring(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-sm truncate" title={`@${message.username}`}>
            {name}
          </span>
          {message.isCreator && (
            <Badge variant="destructive" className="text-xs">
              {creatorLabel}
            </Badge>
          )}
          {isTip && (
            <Badge className="text-xs bg-amber-500 hover:bg-amber-500 text-white">
              <Gift className="h-3 w-3 mr-1" />
              Pourboire {formatEuros(message.tipAmount)}
            </Badge>
          )}
          {muted && (
            <Badge variant="outline" className="text-xs">
              <MicOff className="h-3 w-3 mr-1" />
              Muet
            </Badge>
          )}
        </div>
        <p className="text-sm break-words whitespace-pre-wrap">{message.message}</p>
      </div>
      {canModerate && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
              aria-label="Modérer ce message"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onDelete && (
              <DropdownMenuItem onSelect={() => onDelete(message)} className="text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Supprimer le message
              </DropdownMenuItem>
            )}
            {onToggleMute && (
              <DropdownMenuItem onSelect={() => onToggleMute(message)}>
                {muted ? <Volume2 className="h-4 w-4 mr-2" /> : <MicOff className="h-4 w-4 mr-2" />}
                {muted ? `Réautoriser @${message.username}` : `Rendre @${message.username} muet`}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
})
