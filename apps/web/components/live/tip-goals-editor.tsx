'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, History, Loader2, Plus, Target, Trash2, Undo2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { cn } from '@/lib/utils'
import { liveTipsApi, tipErrorMessage, type TipGoalsSnapshot } from '@/lib/live-tips'
import {
  amountInputValue,
  formatGoalEuros,
  isGoalReached,
  parseGoalAmount,
  sortGoals,
  toGoalsPayload,
  validateGoalDrafts,
  TIP_GOAL_LABEL_MAX,
  TIP_GOAL_MAX_AMOUNT,
  TIP_GOALS_MAX,
  type GoalDraft,
  type TipGoal,
} from '@/lib/live-tip-goals'
import { TipGoalsProgress } from './tip-goals-progress'

let draftSeq = 0
const newKey = () => `goal-draft-${++draftSeq}`

const toDrafts = (goals: TipGoal[]): GoalDraft[] =>
  sortGoals(goals).map((goal) => ({ key: goal.id, id: goal.id, amount: amountInputValue(goal.amount), label: goal.label }))

interface TipGoalsEditorProps {
  streamId: string
  /** Euros received during the live so far */
  total: number
  /** Saved milestones */
  goals: TipGoal[]
  /** The live is being broadcast: show the progress and the "done" toggles */
  live?: boolean
  /** Milestones saved (the room also receives `tip-goals-updated`) */
  onSaved?: (snapshot: TipGoalsSnapshot) => void
  /** A milestone was marked as done / not done */
  onGoalUpdated?: (goal: TipGoal) => void
  className?: string
}

/**
 * "Objectifs de dons" of a live, for its creator: milestones (amount +
 * what the creator will do) on the live's tip total, editable before and
 * during the live; reached milestones can be marked as done
 */
export function TipGoalsEditor({ streamId, total, goals, live = false, onSaved, onGoalUpdated, className }: TipGoalsEditorProps) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [drafts, setDrafts] = useState<GoalDraft[]>(() => toDrafts(goals))
  const [dirty, setDirty] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingLatest, setLoadingLatest] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const firstAmountRef = useRef<HTMLInputElement>(null)

  const savedById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals])

  // Follow the saved milestones (another tab, reconnection), unless the creator is editing
  useEffect(() => {
    if (!dirty) setDrafts(toDrafts(goals))
  }, [goals, dirty])

  const errors = submitted ? validateGoalDrafts(drafts) : {}
  const hasErrors = Object.keys(errors).length > 0

  const update = (key: string, patch: Partial<GoalDraft>) => {
    setDrafts((prev) => prev.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
    setDirty(true)
    setSaveError(null)
  }

  const addDraft = () => {
    if (drafts.length >= TIP_GOALS_MAX) return
    const highest = drafts.reduce((max, draft) => {
      const amount = parseGoalAmount(draft.amount)
      return Number.isFinite(amount) ? Math.max(max, amount) : max
    }, 0)
    const suggestion = Math.min(TIP_GOAL_MAX_AMOUNT, highest > 0 ? Math.ceil(highest * 2) : 100)
    setDrafts((prev) => [...prev, { key: newKey(), amount: String(suggestion), label: '' }])
    setDirty(true)
  }

  const removeDraft = async (draft: GoalDraft) => {
    const saved = draft.id ? savedById.get(draft.id) : undefined
    if (saved && isGoalReached(saved, total)) {
      const ok = await confirm({
        title: 'Supprimer ce palier atteint ?',
        description: `« ${saved.label} » (${formatGoalEuros(saved.amount)}) a déjà été atteint : vos spectateurs ne le verront plus après l’enregistrement.`,
        confirmText: 'Supprimer',
        variant: 'destructive',
      })
      if (!ok) return
    }
    setDrafts((prev) => prev.filter((other) => other.key !== draft.key))
    setDirty(true)
    setSaveError(null)
  }

  const save = async () => {
    setSubmitted(true)
    if (Object.keys(validateGoalDrafts(drafts)).length > 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const { data } = await liveTipsApi.replaceGoals(streamId, toGoalsPayload(drafts))
      setDrafts(toDrafts(data.goals))
      setDirty(false)
      setSubmitted(false)
      onSaved?.(data)
      toast({
        title: data.goals.length > 0 ? 'Paliers enregistrés' : 'Paliers retirés',
        description:
          data.goals.length > 0
            ? `${data.goals.length} palier${data.goals.length > 1 ? 's' : ''}, triés par montant.`
            : 'Ce live n’a plus d’objectifs de dons.',
      })
    } catch (error) {
      setSaveError(tipErrorMessage(error, "Impossible d'enregistrer les paliers. Réessayez."))
    } finally {
      setSaving(false)
    }
  }

  const loadLatest = async () => {
    setLoadingLatest(true)
    try {
      const { data } = await liveTipsApi.getLatestGoals(streamId)
      if (!data.goals.length) {
        toast({ title: 'Aucun palier à reprendre', description: 'Vos lives précédents n’avaient pas d’objectifs de dons.' })
        return
      }
      // A milestone of this live with the same amount keeps its id (and its reached state)
      const idByAmount = new Map(goals.map((goal) => [goal.amount, goal.id]))
      setDrafts(
        [...data.goals]
          .sort((a, b) => a.amount - b.amount)
          .slice(0, TIP_GOALS_MAX)
          .map((goal) => {
            const id = idByAmount.get(goal.amount)
            return { key: newKey(), ...(id ? { id } : {}), amount: amountInputValue(goal.amount), label: goal.label }
          }),
      )
      setDirty(true)
      setSubmitted(false)
      setSaveError(null)
      toast({ title: 'Paliers repris', description: 'Vérifiez-les puis enregistrez pour les appliquer à ce live.' })
      firstAmountRef.current?.focus()
    } catch (error) {
      toast({
        title: 'Impossible de reprendre les paliers',
        description: tipErrorMessage(error, 'Réessayez dans un instant.'),
        variant: 'destructive',
      })
    } finally {
      setLoadingLatest(false)
    }
  }

  const toggleCompleted = async (goal: TipGoal) => {
    setTogglingId(goal.id)
    try {
      const { data } = await liveTipsApi.setGoalCompleted(streamId, goal.id, !goal.completedAt)
      onGoalUpdated?.(data.goal)
      toast({ title: data.goal.completedAt ? 'Palier marqué comme fait' : 'Palier remis à faire' })
    } catch (error) {
      toast({
        title: 'Impossible de modifier le palier',
        description: tipErrorMessage(error, 'Réessayez dans un instant.'),
        variant: 'destructive',
      })
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <Card data-testid="tip-goals-editor" className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5" /> Objectifs de dons
        </CardTitle>
        <CardDescription>
          Une cagnotte commune pour ce live : chaque palier se débloque quand le total des pourboires l’atteint, sous
          les yeux de vos spectateurs.
          {live && (
            <>
              {' '}
              Pourboires reçus pendant ce live :{' '}
              <span className="font-medium text-foreground" data-testid="tip-goals-editor-total">
                {formatGoalEuros(total)}
              </span>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {live && goals.length > 0 && <TipGoalsProgress total={total} goals={goals} showList={false} />}

        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {drafts.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Aucun palier pour ce live. Ajoutez-en un, par exemple « 100 € → je réponds à toutes vos questions ».
            </p>
          ) : (
            <ol className="space-y-3">
              {drafts.map((draft, index) => {
                const rowErrors = errors[draft.key] ?? {}
                const saved = draft.id ? savedById.get(draft.id) : undefined
                const unchanged =
                  !!saved && parseGoalAmount(draft.amount) === saved.amount && draft.label.trim() === saved.label
                const reached = !!saved && unchanged && isGoalReached(saved, total)
                return (
                  <li key={draft.key} className="space-y-2 rounded-lg border p-3" data-testid="tip-goal-row">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="w-28 shrink-0 space-y-1">
                        <Label htmlFor={`${draft.key}-amount`} className="text-xs">
                          Montant (€)
                        </Label>
                        <Input
                          id={`${draft.key}-amount`}
                          ref={index === 0 ? firstAmountRef : undefined}
                          inputMode="decimal"
                          autoComplete="off"
                          value={draft.amount}
                          placeholder="100"
                          aria-invalid={!!rowErrors.amount}
                          className={cn(rowErrors.amount && 'border-destructive')}
                          onChange={(e) => update(draft.key, { amount: e.target.value })}
                        />
                      </div>
                      <div className="min-w-[10rem] flex-1 space-y-1">
                        <Label htmlFor={`${draft.key}-label`} className="text-xs">
                          Ce que vous ferez
                        </Label>
                        <Input
                          id={`${draft.key}-label`}
                          value={draft.label}
                          maxLength={TIP_GOAL_LABEL_MAX + 20}
                          placeholder="Je réponds à toutes vos questions"
                          aria-invalid={!!rowErrors.label}
                          className={cn(rowErrors.label && 'border-destructive')}
                          onChange={(e) => update(draft.key, { label: e.target.value })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-5 h-9 w-9 shrink-0"
                        onClick={() => void removeDraft(draft)}
                        aria-label={`Supprimer le palier ${draft.label.trim() || index + 1}`}
                        title="Supprimer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {(rowErrors.amount || rowErrors.label) && (
                      <div className="space-y-0.5 text-sm text-destructive">
                        {rowErrors.amount && <p>{rowErrors.amount}</p>}
                        {rowErrors.label && <p>{rowErrors.label}</p>}
                      </div>
                    )}
                    {reached && saved && (
                      <div className="flex flex-wrap items-center gap-2" data-testid="tip-goal-reached-row">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                          <Check className="h-3 w-3" /> Atteint
                        </span>
                        {saved.completedAt && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                            Fait
                          </span>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant={saved.completedAt ? 'outline' : 'secondary'}
                          className="h-8"
                          disabled={togglingId === saved.id}
                          onClick={() => void toggleCompleted(saved)}
                        >
                          {togglingId === saved.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : saved.completedAt ? (
                            <Undo2 className="mr-1 h-3.5 w-3.5" />
                          ) : (
                            <Check className="mr-1 h-3.5 w-3.5" />
                          )}
                          {saved.completedAt ? 'Annuler' : 'Marquer comme fait'}
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}

          {hasErrors && <p className="text-sm text-destructive">Corrigez les paliers signalés avant d’enregistrer.</p>}
          {saveError && (
            <p className="text-sm text-destructive" role="alert">
              {saveError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={addDraft} disabled={drafts.length >= TIP_GOALS_MAX}>
              <Plus className="mr-1 h-4 w-4" /> Ajouter un palier
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-10 max-w-full whitespace-normal text-left"
              onClick={() => void loadLatest()}
              disabled={loadingLatest}
            >
              {loadingLatest ? <Loader2 className="mr-1 h-4 w-4 shrink-0 animate-spin" /> : <History className="mr-1 h-4 w-4 shrink-0" />}
              Reprendre les paliers de mon dernier live
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saving || !dirty}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer les paliers
            </Button>
            <span className="text-xs text-muted-foreground">
              {drafts.length}/{TIP_GOALS_MAX} paliers · triés par montant à l’enregistrement
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
