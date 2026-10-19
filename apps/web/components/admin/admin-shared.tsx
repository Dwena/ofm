'use client'

import { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface Paginated<T> {
  items: T[]
  pagination: Pagination
}

export function getErrorMessage(error: any, fallback = 'Une erreur est survenue'): string {
  const message = error?.response?.data?.message
  if (Array.isArray(message)) return message.join(', ')
  return message || error?.message || fallback
}

export function timeAgo(date?: string | null) {
  if (!date) return '—'
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr })
}

export function formatDateTime(date?: string | null) {
  if (!date) return '—'
  return format(new Date(date), 'dd MMM yyyy HH:mm', { locale: fr })
}

const userStatusLabels: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Actif', className: 'bg-green-500 text-white' },
  SUSPENDED: { label: 'Suspendu', className: 'bg-yellow-500 text-white' },
  BANNED: { label: 'Banni', className: 'bg-red-600 text-white' },
  PENDING_VERIFICATION: { label: 'Non vérifié', className: 'bg-gray-500 text-white' },
}

export function UserStatusBadge({ status }: { status: string }) {
  const config = userStatusLabels[status] || { label: status, className: '' }
  return <Badge className={config.className}>{config.label}</Badge>
}

const roleLabels: Record<string, string> = {
  CREATOR: 'Créateur',
  SUBSCRIBER: 'Abonné',
  ADMIN: 'Admin',
  MODERATOR: 'Modérateur',
}

export function RoleBadge({ role }: { role: string }) {
  return <Badge variant="outline">{roleLabels[role] || role}</Badge>
}

const reportStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'En attente', className: 'bg-orange-500 text-white' },
  REVIEWING: { label: 'En examen', className: 'bg-blue-500 text-white' },
  RESOLVED: { label: 'Résolu', className: 'bg-green-500 text-white' },
  REJECTED: { label: 'Rejeté', className: 'bg-gray-500 text-white' },
}

export function ReportStatusBadge({ status }: { status: string }) {
  const config = reportStatusLabels[status] || { label: status, className: '' }
  return <Badge className={config.className}>{config.label}</Badge>
}

const contentStatusLabels: Record<string, { label: string; className: string }> = {
  PUBLISHED: { label: 'Publié', className: 'bg-green-500 text-white' },
  DRAFT: { label: 'Brouillon', className: 'bg-gray-500 text-white' },
  ARCHIVED: { label: 'Archivé', className: 'bg-slate-500 text-white' },
  UNDER_REVIEW: { label: 'En révision', className: 'bg-orange-500 text-white' },
  REJECTED: { label: 'Retiré', className: 'bg-red-600 text-white' },
}

export function ContentStatusBadge({ status }: { status: string }) {
  const config = contentStatusLabels[status] || { label: status, className: '' }
  return <Badge className={config.className}>{config.label}</Badge>
}

export function LoadingState({ label = 'Chargement...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-muted-foreground">{children}</div>
}

export function PaginationControls({
  pagination,
  onPageChange,
}: {
  pagination?: Pagination
  onPageChange: (page: number) => void
}) {
  if (!pagination || pagination.totalPages <= 1) {
    return pagination ? (
      <p className="pt-4 text-sm text-muted-foreground">{pagination.total} résultat(s)</p>
    ) : null
  }

  return (
    <div className="flex items-center justify-between pt-4">
      <p className="text-sm text-muted-foreground">
        {pagination.total} résultat(s) • page {pagination.page} / {pagination.totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Précédent
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Suivant
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Confirmation dialog asking for a reason before a moderation action
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmer',
  destructive,
  reason,
  onReasonChange,
  reasonRequired = true,
  isPending,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  reason: string
  onReasonChange: (value: string) => void
  reasonRequired?: boolean
  isPending?: boolean
  onConfirm: () => void
  children?: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4">
          {children}
          <div className="space-y-2">
            <Label htmlFor="moderation-reason">
              Raison {reasonRequired && <span className="text-red-500">*</span>}
            </Label>
            <Textarea
              id="moderation-reason"
              placeholder="Expliquez la raison de cette décision..."
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Annuler
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isPending || (reasonRequired && !reason.trim())}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
