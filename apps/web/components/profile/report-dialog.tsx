'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { moderationApi } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'

export type ReportedType = 'USER' | 'CONTENT' | 'COMMENT' | 'MESSAGE'

// Same values as the API's ReportReason enum
export const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'SPAM', label: 'Spam' },
  { value: 'HARASSMENT', label: 'Harcèlement' },
  { value: 'HATE_SPEECH', label: 'Discours haineux' },
  { value: 'NUDITY', label: 'Nudité' },
  { value: 'VIOLENCE', label: 'Violence' },
  { value: 'FAKE_NEWS', label: 'Fausse information' },
  { value: 'COPYRIGHT', label: 'Droits d\'auteur' },
  { value: 'UNDERAGE', label: 'Mineur' },
  { value: 'ILLEGAL_CONTENT', label: 'Contenu illégal' },
  { value: 'OTHER', label: 'Autre' },
]

const MAX_DESCRIPTION = 1000

interface ReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportedType: ReportedType
  reportedId: string
  // e.g. "@alice" — shown in the dialog title
  targetLabel: string
}

/**
 * Report a user / content to the moderation team (POST /moderation/reports)
 */
export default function ReportDialog({ open, onOpenChange, reportedType, reportedId, targetLabel }: ReportDialogProps) {
  const [reason, setReason] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setReason(null)
      setDescription('')
      setError(null)
    }
  }, [open])

  const reportMutation = useMutation({
    mutationFn: () =>
      moderationApi.createReport({
        reportedType,
        reportedId,
        reason: reason as string,
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      toast({
        title: 'Signalement envoyé',
        description: 'Merci, notre équipe de modération va l\'examiner.',
      })
      onOpenChange(false)
    },
    onError: (err: any) => {
      const message = err?.response?.data?.message
      setError(Array.isArray(message) ? message.join(', ') : message || 'Impossible d\'envoyer le signalement.')
    },
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!reason) {
      setError('Choisissez un motif.')
      return
    }
    if (reason === 'OTHER' && !description.trim()) {
      setError('Précisez le motif du signalement.')
      return
    }
    setError(null)
    reportMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !reportMutation.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Signaler {targetLabel}</DialogTitle>
            <DialogDescription>
              Votre signalement est anonyme pour la personne concernée.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-2">Motif</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup">
              {REPORT_REASONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    reason === option.value ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={option.value}
                    checked={reason === option.value}
                    onChange={() => {
                      setReason(option.value)
                      setError(null)
                    }}
                    className="accent-primary"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="report-description">
              Détails {reason === 'OTHER' ? '' : '(facultatif)'}
            </Label>
            <Textarea
              id="report-description"
              rows={3}
              maxLength={MAX_DESCRIPTION}
              value={description}
              placeholder="Décrivez le problème…"
              onChange={(e) => {
                setDescription(e.target.value)
                setError(null)
              }}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={reportMutation.isPending}
            >
              Annuler
            </Button>
            <Button type="submit" variant="destructive" disabled={reportMutation.isPending}>
              {reportMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Signaler
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
