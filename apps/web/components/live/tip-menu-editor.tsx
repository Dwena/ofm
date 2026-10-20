'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, Gift, Loader2, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { cn, formatEuros } from '@/lib/utils'
import { liveTipsApi, tipErrorMessage, type OwnTipMenu } from '@/lib/live-tips'

const LABEL_MAX = 100
const DESCRIPTION_MAX = 200
const EMOJI_MAX = 16

export const OWN_TIP_MENU_QUERY_KEY = ['tip-menu', 'me']

interface DraftItem {
  /** React key (the item id once saved) */
  key: string
  id?: string
  emoji: string
  label: string
  description: string
  amount: string
  isActive: boolean
}

interface ItemErrors {
  label?: string
  amount?: string
  description?: string
  emoji?: string
}

let draftCounter = 0
const newKey = () => `new-${Date.now()}-${draftCounter++}`

const toDraft = (menu: OwnTipMenu | undefined): DraftItem[] =>
  (menu?.items ?? []).map((item) => ({
    key: item.id,
    id: item.id,
    emoji: item.emoji ?? '',
    label: item.label,
    description: item.description ?? '',
    amount: String(item.amount),
    isActive: item.isActive,
  }))

const parseAmount = (value: string) => Number(value.replace(',', '.'))

interface TipMenuEditorProps {
  /** Start collapsed (e.g. while broadcasting) */
  defaultOpen?: boolean
  className?: string
}

/**
 * "Menu de pourboires" editor of the creator: items reused from one live to
 * the next (usable before and during a live)
 */
export function TipMenuEditor({ defaultOpen = true, className }: TipMenuEditorProps) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(defaultOpen)
  const [items, setItems] = useState<DraftItem[]>([])
  const [dirty, setDirty] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data: menu, isLoading, isError, refetch } = useQuery({
    queryKey: OWN_TIP_MENU_QUERY_KEY,
    queryFn: async () => (await liveTipsApi.getOwnMenu()).data,
  })

  const minimum = menu?.minimumAmount ?? 1
  const maximum = menu?.maximumAmount ?? 10000
  const maxItems = menu?.maxItems ?? 20

  // Load the saved menu, unless the creator is editing it
  useEffect(() => {
    if (menu && !dirty) setItems(toDraft(menu))
  }, [menu, dirty])

  const validateItem = (item: DraftItem): ItemErrors => {
    const errors: ItemErrors = {}
    const label = item.label.trim()
    if (!label) errors.label = 'L’intitulé est obligatoire.'
    else if (label.length > LABEL_MAX) errors.label = `${LABEL_MAX} caractères maximum.`
    if (item.description.trim().length > DESCRIPTION_MAX) {
      errors.description = `${DESCRIPTION_MAX} caractères maximum.`
    }
    if (item.emoji.trim().length > EMOJI_MAX) errors.emoji = 'Un ou deux emojis maximum.'
    const amount = parseAmount(item.amount)
    if (!item.amount.trim() || !Number.isFinite(amount)) errors.amount = 'Indiquez un montant.'
    else if (amount < minimum || amount > maximum) {
      errors.amount = `Entre ${formatEuros(minimum)} et ${formatEuros(maximum)}.`
    } else if (Math.round(amount * 100) !== amount * 100) errors.amount = 'Deux décimales maximum.'
    return errors
  }

  // Inline errors are shown once the creator tried to save
  const errors: ItemErrors[] = submitted ? items.map(validateItem) : []

  const update = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)))
    setDirty(true)
    setSaveError(null)
  }

  const move = (index: number, delta: -1 | 1) => {
    setItems((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setDirty(true)
  }

  const addItem = () => {
    if (items.length >= maxItems) return
    setItems((prev) => [
      ...prev,
      { key: newKey(), emoji: '', label: '', description: '', amount: String(Math.max(5, minimum)), isActive: true },
    ])
    setDirty(true)
    setOpen(true)
  }

  const removeItem = async (item: DraftItem) => {
    const ok = await confirm({
      title: 'Supprimer ce palier ?',
      description: item.label.trim()
        ? `« ${item.label.trim()} » sera retiré du menu après l’enregistrement. Les demandes déjà reçues sont conservées.`
        : 'Ce palier sera retiré du menu après l’enregistrement.',
      confirmText: 'Supprimer',
      variant: 'destructive',
    })
    if (!ok) return
    setItems((prev) => prev.filter((other) => other.key !== item.key))
    setDirty(true)
  }

  const saveMutation = useMutation({
    mutationFn: async (draft: DraftItem[]) =>
      (
        await liveTipsApi.replaceMenu(
          draft.map((item) => ({
            ...(item.id && { id: item.id }),
            label: item.label.trim(),
            description: item.description.trim() || null,
            amount: Math.round(parseAmount(item.amount) * 100) / 100,
            emoji: item.emoji.trim() || null,
            isActive: item.isActive,
          })),
        )
      ).data,
    onSuccess: (saved) => {
      queryClient.setQueryData(OWN_TIP_MENU_QUERY_KEY, saved)
      setItems(toDraft(saved))
      setDirty(false)
      setSubmitted(false)
      toast({ title: 'Menu de pourboires enregistré', description: 'Vos spectateurs le voient dès maintenant.' })
    },
    onError: (error) => {
      setSaveError(tipErrorMessage(error, 'Impossible d’enregistrer le menu. Réessayez.'))
    },
  })

  const handleSave = () => {
    setSubmitted(true)
    if (items.some((item) => Object.keys(validateItem(item)).length > 0)) {
      setSaveError('Corrigez les paliers signalés avant d’enregistrer.')
      return
    }
    setSaveError(null)
    saveMutation.mutate(items)
  }

  const handleCancel = () => {
    setItems(toDraft(menu))
    setDirty(false)
    setSubmitted(false)
    setSaveError(null)
  }

  const activeCount = items.filter((item) => item.isActive).length

  return (
    <Card className={cn('min-w-0', className)} data-testid="tip-menu-editor">
      <CardHeader className="pb-3">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-2 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Gift className="h-5 w-5" /> Menu de pourboires
            </CardTitle>
            <CardDescription className="mt-1.5">
              Des demandes à prix fixe que vos fans choisissent pendant le live (chanson, question…).{' '}
              {menu && `${activeCount} palier${activeCount > 1 ? 's' : ''} visible${activeCount > 1 ? 's' : ''}.`}
            </CardDescription>
          </div>
          <ChevronDown className={cn('h-5 w-5 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {isLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {isError && (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">Impossible de charger votre menu.</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Réessayer
              </Button>
            </div>
          )}
          {menu && (
            <>
              {items.length === 0 && (
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  Aucun palier pour le moment. Ajoutez par exemple « Je dis ton prénom » à {formatEuros(Math.max(5, minimum))}.
                </p>
              )}
              <ol className="space-y-3">
                {items.map((item, index) => {
                  const itemErrors = errors[index] ?? {}
                  const fieldId = `tip-item-${item.key}`
                  return (
                    <li
                      key={item.key}
                      className={cn('rounded-lg border p-3 space-y-2', !item.isActive && 'bg-muted/50')}
                      data-testid="tip-menu-editor-item"
                    >
                      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_7.5rem]">
                        <div className="space-y-1">
                          <Label htmlFor={`${fieldId}-emoji`} className="text-xs">
                            Emoji
                          </Label>
                          <Input
                            id={`${fieldId}-emoji`}
                            value={item.emoji}
                            maxLength={EMOJI_MAX}
                            placeholder="🎵"
                            className="px-2 text-center"
                            onChange={(e) => update(item.key, { emoji: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1 min-w-0">
                          <Label htmlFor={`${fieldId}-label`} className="text-xs">
                            Intitulé
                          </Label>
                          <Input
                            id={`${fieldId}-label`}
                            value={item.label}
                            maxLength={LABEL_MAX}
                            placeholder="Je chante une chanson"
                            aria-invalid={!!itemErrors.label}
                            className={itemErrors.label ? 'border-destructive' : undefined}
                            onChange={(e) => update(item.key, { label: e.target.value })}
                          />
                          {itemErrors.label && <p className="text-xs text-destructive">{itemErrors.label}</p>}
                        </div>
                        <div className="col-span-2 space-y-1 sm:col-span-1">
                          <Label htmlFor={`${fieldId}-amount`} className="text-xs">
                            Montant (€)
                          </Label>
                          <Input
                            id={`${fieldId}-amount`}
                            type="number"
                            inputMode="decimal"
                            min={minimum}
                            max={maximum}
                            step="0.01"
                            value={item.amount}
                            aria-invalid={!!itemErrors.amount}
                            className={itemErrors.amount ? 'border-destructive' : undefined}
                            onChange={(e) => update(item.key, { amount: e.target.value })}
                          />
                          {itemErrors.amount && <p className="text-xs text-destructive">{itemErrors.amount}</p>}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${fieldId}-description`} className="text-xs">
                          Description (optionnel)
                        </Label>
                        <Input
                          id={`${fieldId}-description`}
                          value={item.description}
                          maxLength={DESCRIPTION_MAX}
                          placeholder="Précisez ce que vous ferez"
                          aria-invalid={!!itemErrors.description}
                          onChange={(e) => update(item.key, { description: e.target.value })}
                        />
                        {(itemErrors.description || itemErrors.emoji) && (
                          <p className="text-xs text-destructive">{itemErrors.description || itemErrors.emoji}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          aria-label="Monter"
                          title="Monter"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => move(index, 1)}
                          disabled={index === items.length - 1}
                          aria-label="Descendre"
                          title="Descendre"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => update(item.key, { isActive: !item.isActive })}
                          aria-pressed={!item.isActive}
                        >
                          {item.isActive ? <Eye className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
                          {item.isActive ? 'Visible' : 'Masqué'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 ml-auto text-destructive hover:text-destructive"
                          onClick={() => void removeItem(item)}
                          aria-label={`Supprimer ${item.label || 'ce palier'}`}
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> Supprimer
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={addItem} disabled={items.length >= maxItems}>
                  <Plus className="h-4 w-4 mr-1" /> Ajouter un palier
                </Button>
                <span className="text-xs text-muted-foreground">
                  {items.length}/{maxItems} · montant minimum {formatEuros(minimum)}
                </span>
              </div>
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
              {dirty && (
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
                    {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Enregistrer le menu
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleCancel} disabled={saveMutation.isPending}>
                    Annuler les modifications
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
