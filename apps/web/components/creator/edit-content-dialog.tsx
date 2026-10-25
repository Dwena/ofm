'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { CoPerformersPicker } from '@/components/creator/co-performers-picker'
import { contentCoPerformersApi } from '@/lib/verification'
import { toast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ContentVisibility,
  CreatorContentItem,
  PPV_MAX_PRICE,
  PPV_MIN_PRICE,
  VISIBILITY_OPTIONS,
  contentErrorMessage,
  parsePrice,
  toDateTimeLocal,
  validatePpvPrice,
  validateScheduleDate,
} from '@/lib/creator-content'

type EditableContent = Pick<
  CreatorContentItem,
  'id' | 'title' | 'description' | 'visibility' | 'isPpv' | 'ppvPrice' | 'status' | 'scheduledFor' | 'soloContent' | 'coPerformers'
>

interface EditContentDialogProps {
  content: EditableContent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Edit title, description, visibility, PPV price and (for drafts) the publication date.
 */
export function EditContentDialog({ content, open, onOpenChange }: EditContentDialogProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<ContentVisibility>('SUBSCRIBERS_ONLY')
  const [price, setPrice] = useState('')
  const [scheduled, setScheduled] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [soloContent, setSoloContent] = useState(true)
  const [coPerformerIds, setCoPerformerIds] = useState<string[]>([])

  // Reset the form each time another content is opened
  useEffect(() => {
    if (!content || !open) return
    setTitle(content.title ?? '')
    setDescription(content.description ?? '')
    setVisibility(content.isPpv ? 'PPV' : content.visibility)
    setPrice(content.ppvPrice != null ? String(content.ppvPrice) : '')
    setScheduled(!!content.scheduledFor)
    setScheduledFor(content.scheduledFor ? toDateTimeLocal(content.scheduledFor) : '')
    setSoloContent(content.soloContent ?? true)
    setCoPerformerIds((content.coPerformers ?? []).map((row) => row.coPerformer.id))
    setSubmitted(false)
  }, [content, open])

  const initialCoPerformerIds = (content?.coPerformers ?? []).map((row) => row.coPerformer.id)
  const coPerformersChanged =
    soloContent !== (content?.soloContent ?? true) ||
    coPerformerIds.length !== initialCoPerformerIds.length ||
    coPerformerIds.some((id) => !initialCoPerformerIds.includes(id))

  const isDraft = content?.status === 'DRAFT'
  const isPpv = visibility === 'PPV'

  const errors = {
    title: !title.trim() ? 'Le titre est obligatoire' : null,
    price: isPpv ? validatePpvPrice(price) : null,
    scheduledFor: isDraft && scheduled ? validateScheduleDate(scheduledFor) : null,
    coPerformers: !soloContent && coPerformerIds.length === 0 ? 'Sélectionnez les personnes présentes' : null,
  }
  const hasErrors = Object.values(errors).some(Boolean)

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await contentCoPerformersApi.update(content!.id, {
        // Only sent when changed: a published content goes back to validation
        ...(coPerformersChanged && { soloContent, coPerformerIds: soloContent ? [] : coPerformerIds }),
        title: title.trim(),
        description: description.trim(),
        visibility,
        isPpv,
        ppvPrice: isPpv ? parsePrice(price) : null,
        ...(isDraft && {
          scheduledFor: scheduled ? new Date(scheduledFor).toISOString() : null,
        }),
      })
      return response.data
    },
    onSuccess: (updated: any) => {
      queryClient.invalidateQueries({ queryKey: ['my-content'] })
      queryClient.invalidateQueries({ queryKey: ['creator-content'] })
      queryClient.invalidateQueries({ queryKey: ['content', content!.id] })
      toast(
        updated?.status === 'UNDER_REVIEW' && content?.status !== 'UNDER_REVIEW'
          ? { title: 'Contenu renvoyé en validation', description: 'Il sera de nouveau visible après validation par notre équipe.' }
          : { title: 'Contenu mis à jour' },
      )
      onOpenChange(false)
    },
    onError: (error) => {
      toast({
        title: 'Impossible d’enregistrer',
        description: contentErrorMessage(error),
        variant: 'destructive',
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (hasErrors || mutation.isPending) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate data-testid="edit-content-form">
          <DialogHeader>
            <DialogTitle>Modifier le contenu</DialogTitle>
            <DialogDescription>Les changements sont visibles immédiatement par vos fans.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="edit-title">
              Titre <span className="text-red-500">*</span>
            </Label>
            <Input
              id="edit-title"
              data-testid="edit-content-title"
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={submitted && !!errors.title}
            />
            {submitted && errors.title && <p className="text-xs text-red-600">{errors.title}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              data-testid="edit-content-description"
              value={description}
              maxLength={1000}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{description.length}/1000 caractères</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-visibility">Visibilité</Label>
            <Select value={visibility} onValueChange={(value) => setVisibility(value as ContentVisibility)}>
              <SelectTrigger id="edit-visibility" data-testid="edit-content-visibility" aria-label="Visibilité">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} — {option.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isPpv && (
            <div className="space-y-2">
              <Label htmlFor="edit-price">
                Prix PPV (€) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-price"
                data-testid="edit-content-price"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={PPV_MIN_PRICE}
                max={PPV_MAX_PRICE}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-invalid={submitted && !!errors.price}
              />
              {submitted && errors.price && <p className="text-xs text-red-600">{errors.price}</p>}
            </div>
          )}

          {isDraft && (
            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={scheduled}
                  onChange={(e) => setScheduled(e.target.checked)}
                  data-testid="edit-content-schedule-toggle"
                />
                Programmer la publication
              </label>
              {scheduled && (
                <>
                  <Input
                    type="datetime-local"
                    aria-label="Date de publication"
                    value={scheduledFor}
                    min={toDateTimeLocal(new Date())}
                    onChange={(e) => setScheduledFor(e.target.value)}
                    aria-invalid={submitted && !!errors.scheduledFor}
                  />
                  {submitted && errors.scheduledFor && (
                    <p className="text-xs text-red-600">{errors.scheduledFor}</p>
                  )}
                </>
              )}
              {!scheduled && (
                <p className="text-xs text-muted-foreground">Le contenu restera un brouillon jusqu’à sa publication.</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Personnes présentes</Label>
            <CoPerformersPicker
              soloContent={soloContent}
              onSoloContentChange={setSoloContent}
              selectedIds={coPerformerIds}
              onSelectedIdsChange={setCoPerformerIds}
              disabled={mutation.isPending}
              showError={submitted}
            />
            {coPerformersChanged && content?.status === 'PUBLISHED' && (
              <p className="text-xs text-muted-foreground">
                Modifier les personnes présentes renvoie le contenu en validation avant qu’il ne soit de nouveau visible.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Annuler
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="edit-content-submit">
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
