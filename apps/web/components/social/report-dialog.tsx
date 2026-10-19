'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Flag, Loader2 } from 'lucide-react'
import { moderationApi } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type ReportTargetType = 'CONTENT' | 'COMMENT' | 'USER' | 'MESSAGE'

export interface ReportTarget {
  type: ReportTargetType
  id: string
}

// Values accepted by POST /moderation/reports (ReportReason)
const REPORT_REASONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'SPAM', label: 'Spam ou arnaque', hint: 'Publicité, liens frauduleux, contenu répétitif' },
  { value: 'HARASSMENT', label: 'Harcèlement', hint: 'Insultes, menaces, intimidation' },
  { value: 'HATE_SPEECH', label: 'Discours haineux', hint: 'Propos discriminatoires' },
  { value: 'NUDITY', label: 'Nudité non conforme', hint: 'Contenu explicite hors des règles de la plateforme' },
  { value: 'VIOLENCE', label: 'Violence', hint: 'Contenu violent ou choquant' },
  { value: 'FAKE_NEWS', label: 'Fausse information', hint: 'Désinformation ou usurpation d’identité' },
  { value: 'COPYRIGHT', label: "Droits d'auteur", hint: 'Contenu repris sans autorisation' },
  { value: 'UNDERAGE', label: 'Mineur', hint: 'Implique une personne mineure' },
  { value: 'ILLEGAL_CONTENT', label: 'Contenu illégal', hint: 'Activité ou produit illégal' },
  { value: 'OTHER', label: 'Autre', hint: 'Précisez le problème ci-dessous' },
]

const TARGET_LABELS: Record<ReportTargetType, string> = {
  CONTENT: 'cette publication',
  COMMENT: 'ce commentaire',
  USER: 'cet utilisateur',
  MESSAGE: 'ce message',
}

interface ReportDialogProps {
  target: ReportTarget | null
  onClose: () => void
}

/**
 * Reason picker sending a report to the moderation team
 */
export default function ReportDialog({ target, onClose }: ReportDialogProps) {
  const [reason, setReason] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  // Reset the form each time the dialog opens for a new target
  useEffect(() => {
    if (target) {
      setReason(null)
      setDescription('')
      setShowErrors(false)
    }
  }, [target])

  const descriptionRequired = reason === 'OTHER'
  const reasonError = showErrors && !reason ? 'Choisissez un motif' : null
  const descriptionError =
    showErrors && descriptionRequired && !description.trim()
      ? 'Décrivez le problème pour le motif « Autre »'
      : null

  const reportMutation = useMutation({
    mutationFn: async () => {
      if (!target || !reason) return null
      const response = await moderationApi.createReport({
        reportedType: target.type,
        reportedId: target.id,
        reason,
        description: description.trim() || undefined,
      })
      return response.data as { message?: string }
    },
    onSuccess: (data) => {
      toast({
        title: 'Signalement envoyé',
        description: data?.message || 'Notre équipe de modération va examiner ce signalement.',
      })
      onClose()
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message
      toast({
        title: 'Signalement impossible',
        description: Array.isArray(message) ? message[0] : message || 'Réessayez dans un instant.',
        variant: 'destructive',
      })
    },
  })

  const handleSubmit = () => {
    setShowErrors(true)
    if (!reason || (descriptionRequired && !description.trim())) return
    reportMutation.mutate()
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && !reportMutation.isPending && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" />
            Signaler {target ? TARGET_LABELS[target.type] : ''}
          </DialogTitle>
          <DialogDescription>
            Votre signalement est anonyme pour l&apos;auteur et sera examiné par notre équipe de modération.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Motif</Label>
            <div role="radiogroup" aria-label="Motif du signalement" className="grid gap-2 sm:grid-cols-2">
              {REPORT_REASONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={reason === item.value}
                  onClick={() => setReason(item.value)}
                  className={cn(
                    'rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    reason === item.value && 'border-primary bg-primary/5 ring-1 ring-primary',
                  )}
                >
                  <span className="font-medium block">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.hint}</span>
                </button>
              ))}
            </div>
            {reasonError && <p className="text-sm text-destructive">{reasonError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-description">
              Détails {descriptionRequired ? '' : '(facultatif)'}
            </Label>
            <Textarea
              id="report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Ajoutez des précisions utiles pour la modération"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="text-destructive">{descriptionError}</span>
              <span>{description.length}/1000</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={reportMutation.isPending}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={reportMutation.isPending}>
            {reportMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Envoyer le signalement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
