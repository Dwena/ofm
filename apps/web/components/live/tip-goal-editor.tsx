'use client'

import { useEffect, useState } from 'react'
import { Loader2, Target, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { formatEuros } from '@/lib/utils'
import { liveTipsApi, tipErrorMessage } from '@/lib/live-tips'
import { TipGoalProgress } from './tip-goal-progress'

const GOAL_MIN = 1
const GOAL_MAX = 100000
const LABEL_MAX = 120

interface TipGoalEditorProps {
  streamId: string
  amount: number | null
  label: string | null
  total: number
  /** Called with the saved goal (the room also receives `tip-goal-updated`) */
  onSaved?: (goal: { amount: number | null; label: string | null; total: number }) => void
}

/**
 * "Objectif de la live": amount + label, progress, clear (creator)
 */
export function TipGoalEditor({ streamId, amount, label, total, onSaved }: TipGoalEditorProps) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [amountInput, setAmountInput] = useState(amount ? String(amount) : '')
  const [labelInput, setLabelInput] = useState(label ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Follow the goal when it changes elsewhere (another tab, reconnection)
  useEffect(() => {
    setAmountInput(amount ? String(amount) : '')
    setLabelInput(label ?? '')
  }, [amount, label])

  const save = async (nextAmount: number | null, nextLabel: string | null) => {
    setSaving(true)
    try {
      const { data } = await liveTipsApi.setGoal(streamId, nextAmount, nextLabel)
      onSaved?.(data)
      toast({ title: nextAmount === null ? 'Objectif retiré' : 'Objectif enregistré' })
    } catch (err) {
      setError(tipErrorMessage(err, "Impossible d'enregistrer l'objectif. Réessayez."))
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = () => {
    const value = Number(amountInput.replace(',', '.'))
    if (!amountInput.trim() || !Number.isFinite(value)) {
      setError('Indiquez le montant de l’objectif.')
      return
    }
    if (value < GOAL_MIN || value > GOAL_MAX) {
      setError(`L’objectif doit être compris entre ${formatEuros(GOAL_MIN)} et ${formatEuros(GOAL_MAX)}.`)
      return
    }
    if (Math.round(value * 100) !== value * 100) {
      setError('Deux décimales maximum.')
      return
    }
    if (labelInput.trim().length > LABEL_MAX) {
      setError(`L’intitulé ne doit pas dépasser ${LABEL_MAX} caractères.`)
      return
    }
    setError(null)
    void save(value, labelInput.trim() || null)
  }

  const handleClear = async () => {
    const ok = await confirm({
      title: 'Retirer l’objectif ?',
      description: 'La barre de progression disparaîtra pour vos spectateurs. Les pourboires reçus restent comptés.',
      confirmText: 'Retirer',
      variant: 'destructive',
    })
    if (ok) void save(null, null)
  }

  return (
    <Card data-testid="tip-goal-editor">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5" /> Objectif de la live
        </CardTitle>
        <CardDescription>
          Une barre de progression visible par vos spectateurs. Pourboires reçus pendant ce live :{' '}
          <span className="font-medium text-foreground">{formatEuros(total)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <TipGoalProgress amount={amount} label={label} total={total} />
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <div className="space-y-1 min-w-0">
              <Label htmlFor="tip-goal-label">Intitulé (optionnel)</Label>
              <Input
                id="tip-goal-label"
                value={labelInput}
                maxLength={LABEL_MAX}
                placeholder="Nouvelle caméra"
                onChange={(e) => {
                  setLabelInput(e.target.value)
                  setError(null)
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tip-goal-amount">Montant (€)</Label>
              <Input
                id="tip-goal-amount"
                type="number"
                inputMode="decimal"
                min={GOAL_MIN}
                max={GOAL_MAX}
                step="0.01"
                value={amountInput}
                placeholder="300"
                aria-invalid={!!error}
                className={error ? 'border-destructive' : undefined}
                onChange={(e) => {
                  setAmountInput(e.target.value)
                  setError(null)
                }}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {amount ? 'Mettre à jour l’objectif' : 'Définir l’objectif'}
            </Button>
            {amount !== null && (
              <Button type="button" variant="outline" onClick={() => void handleClear()} disabled={saving}>
                <X className="h-4 w-4 mr-1" /> Retirer
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
