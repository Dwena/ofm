'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  ALERT_ANIMATION_LABELS,
  ALERT_ANIMATIONS,
  ALERT_SOUND_LABELS,
  ALERT_SOUNDS,
  colorAlpha,
  colorHex,
  DEFAULT_OVERLAY_SETTINGS,
  MAX_TEMPLATE_LENGTH,
  MAX_TITLE_LENGTH,
  validateOverlaySettings,
  withAlpha,
  type OverlaySettingsMap,
  type OverlayWidget,
} from '@/lib/overlay-widgets'

type Field =
  | { key: string; type: 'number'; label: string; min: number; max: number; step?: number; unit?: string; help?: string }
  | { key: string; type: 'slider'; label: string; min: number; max: number; step: number; format: (value: number) => string }
  | { key: string; type: 'switch'; label: string; help?: string }
  | { key: string; type: 'select'; label: string; options: { value: string | number; label: string }[] }
  | { key: string; type: 'text'; label: string; max: number; help?: string; placeholder?: string }
  | { key: string; type: 'color'; label: string }

interface Section {
  title?: string
  fields: Field[]
  /** Shown only when this boolean setting is on */
  when?: string
}

const COLOR_FIELDS: Field[] = [
  { key: 'textColor', type: 'color', label: 'Texte' },
  { key: 'accentColor', type: 'color', label: 'Accent' },
  { key: 'backgroundColor', type: 'color', label: 'Fond' },
]

const fontSize = (min: number, max: number): Field => ({ key: 'fontSize', type: 'number', label: 'Taille du texte', min, max, unit: 'px' })

const SECTIONS: Record<OverlayWidget, Section[]> = {
  ALERTS: [
    {
      fields: [
        { key: 'minAmount', type: 'number', label: 'Montant minimum', min: 0, max: 10000, step: 0.5, unit: '€', help: 'Les pourboires plus petits ne déclenchent pas d’alerte.' },
        { key: 'durationSeconds', type: 'number', label: 'Durée d’affichage', min: 3, max: 20, unit: 's' },
        {
          key: 'animation',
          type: 'select',
          label: 'Animation',
          options: ALERT_ANIMATIONS.map((value) => ({ value, label: ALERT_ANIMATION_LABELS[value] })),
        },
        fontSize(16, 72),
      ],
    },
    {
      title: 'Pourboires',
      fields: [
        { key: 'textTemplate', type: 'text', label: 'Texte de l’alerte', max: MAX_TEMPLATE_LENGTH, help: 'Variables : {name}, {amount}, {message}' },
        { key: 'showMessage', type: 'switch', label: 'Afficher le message du fan' },
      ],
    },
    {
      title: 'Demandes du menu',
      fields: [
        { key: 'menuRequestEnabled', type: 'switch', label: 'Alerte spéciale pour les demandes du menu' },
        { key: 'menuRequestTemplate', type: 'text', label: 'Texte de la demande', max: MAX_TEMPLATE_LENGTH, help: 'Variables : {name}, {item}, {amount}' },
      ],
    },
    {
      title: 'Paliers atteints',
      fields: [
        { key: 'goalReachedEnabled', type: 'switch', label: 'Alerte quand un palier est atteint' },
        { key: 'goalReachedTemplate', type: 'text', label: 'Texte du palier', max: MAX_TEMPLATE_LENGTH, help: 'Variables : {amount}, {label}, {total}' },
      ],
    },
    {
      title: 'Son',
      fields: [
        { key: 'soundEnabled', type: 'switch', label: 'Jouer un son' },
        { key: 'sound', type: 'select', label: 'Son', options: ALERT_SOUNDS.map((value) => ({ value, label: ALERT_SOUND_LABELS[value] })) },
        { key: 'soundVolume', type: 'slider', label: 'Volume', min: 0, max: 1, step: 0.05, format: (value) => `${Math.round(value * 100)} %` },
      ],
    },
    { title: 'Couleurs', fields: COLOR_FIELDS },
  ],
  GOALS: [
    {
      fields: [
        { key: 'title', type: 'text', label: 'Titre', max: MAX_TITLE_LENGTH, placeholder: 'Objectifs de dons' },
        { key: 'layout', type: 'select', label: 'Affichage', options: [{ value: 'bar', label: 'Barre de progression' }, { value: 'list', label: 'Liste' }] },
        { key: 'show', type: 'select', label: 'Paliers affichés', options: [{ value: 'all', label: 'Tous les paliers' }, { value: 'next', label: 'Le prochain palier seulement' }] },
        { key: 'showAmounts', type: 'switch', label: 'Afficher les montants' },
        fontSize(12, 48),
      ],
    },
    { title: 'Couleurs', fields: COLOR_FIELDS },
  ],
  TIP_MENU: [
    {
      fields: [
        { key: 'title', type: 'text', label: 'Titre', max: MAX_TITLE_LENGTH, placeholder: 'Menu des pourboires' },
        { key: 'columns', type: 'select', label: 'Colonnes', options: [{ value: 1, label: '1 colonne' }, { value: 2, label: '2 colonnes' }] },
        { key: 'maxItems', type: 'number', label: 'Nombre de lignes maximum', min: 1, max: 20 },
        { key: 'showDescriptions', type: 'switch', label: 'Afficher les descriptions' },
        fontSize(12, 48),
      ],
    },
    { title: 'Couleurs', fields: COLOR_FIELDS },
  ],
  CHAT: [
    {
      fields: [
        { key: 'maxMessages', type: 'number', label: 'Messages affichés', min: 1, max: 50 },
        { key: 'hideAfterSeconds', type: 'number', label: 'Masquer après', min: 0, max: 600, unit: 's', help: '0 = les messages restent affichés.' },
        { key: 'tipsOnly', type: 'switch', label: 'Pourboires et annonces uniquement' },
        { key: 'showAvatars', type: 'switch', label: 'Afficher les avatars' },
        fontSize(12, 48),
      ],
    },
    { title: 'Couleurs', fields: COLOR_FIELDS },
  ],
  REQUESTS: [
    {
      fields: [
        { key: 'title', type: 'text', label: 'Titre', max: MAX_TITLE_LENGTH, placeholder: 'Demandes du menu' },
        { key: 'includeDone', type: 'switch', label: 'Afficher aussi les demandes réalisées / ignorées' },
        { key: 'maxItems', type: 'number', label: 'Nombre de demandes maximum', min: 1, max: 20 },
        fontSize(12, 48),
      ],
    },
    { title: 'Couleurs', fields: COLOR_FIELDS },
  ],
}

/** Switches that hide the fields depending on them when off */
const DEPENDS_ON: Record<string, string> = {
  menuRequestTemplate: 'menuRequestEnabled',
  goalReachedTemplate: 'goalReachedEnabled',
  sound: 'soundEnabled',
  soundVolume: 'soundEnabled',
}

interface WidgetSettingsFormProps<W extends OverlayWidget> {
  widget: W
  settings: OverlaySettingsMap[W]
  saving: boolean
  onSave: (settings: OverlaySettingsMap[W]) => void
}

/**
 * Settings of one widget (French labels, same bounds as the API). Numbers
 * are typed as text so a field can be emptied while typing.
 */
export function WidgetSettingsForm<W extends OverlayWidget>({ widget, settings, saving, onSave }: WidgetSettingsFormProps<W>) {
  const [draft, setDraft] = useState<Record<string, unknown>>(settings as unknown as Record<string, unknown>)
  // Raw text of the number inputs
  const [numbers, setNumbers] = useState<Record<string, string>>({})

  useEffect(() => {
    setDraft(settings as unknown as Record<string, unknown>)
    setNumbers({})
  }, [settings])

  const parsed = useMemo(() => {
    const result = { ...draft }
    for (const [key, raw] of Object.entries(numbers)) {
      const value = Number(raw.replace(',', '.'))
      result[key] = raw.trim() === '' ? Number.NaN : value
    }
    return result as unknown as OverlaySettingsMap[W]
  }, [draft, numbers])

  const errors = validateOverlaySettings(widget, parsed) as Record<string, string | undefined>
  const hasErrors = Object.values(errors).some(Boolean)
  const dirty = JSON.stringify(parsed) !== JSON.stringify(settings)

  const set = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }))
  const id = (key: string) => `overlay-${widget}-${key}`

  const renderField = (field: Field) => {
    const error = errors[field.key]
    const value = draft[field.key]
    switch (field.type) {
      case 'switch':
        return (
          <label key={field.key} className="flex items-start gap-3 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={value === true}
              onChange={(event) => set(field.key, event.target.checked)}
              data-testid={id(field.key)}
            />
            <span className="min-w-0">
              <span className="font-medium">{field.label}</span>
              {field.help && <span className="block text-muted-foreground">{field.help}</span>}
            </span>
          </label>
        )
      case 'number':
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={id(field.key)}>
              {field.label}
              {field.unit ? ` (${field.unit})` : ''}
            </Label>
            <Input
              id={id(field.key)}
              data-testid={id(field.key)}
              inputMode="decimal"
              value={numbers[field.key] ?? String(value ?? '').replace('.', ',')}
              onChange={(event) => setNumbers((current) => ({ ...current, [field.key]: event.target.value }))}
              aria-invalid={!!error}
            />
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {field.help ?? `De ${field.min.toLocaleString('fr-FR')} à ${field.max.toLocaleString('fr-FR')}.`}
              </p>
            )}
          </div>
        )
      case 'slider':
        return (
          <div key={field.key} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <Label htmlFor={id(field.key)}>{field.label}</Label>
              <span className="tabular-nums text-muted-foreground">{field.format(Number(value))}</span>
            </div>
            <Slider
              id={id(field.key)}
              min={field.min}
              max={field.max}
              step={field.step}
              value={[Number(value)]}
              onValueChange={([next]) => set(field.key, Math.round(next * 100) / 100)}
              aria-label={field.label}
            />
          </div>
        )
      case 'select':
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={id(field.key)}>{field.label}</Label>
            <Select
              value={String(value)}
              onValueChange={(next) => {
                const option = field.options.find((item) => String(item.value) === next)
                if (option) set(field.key, option.value)
              }}
            >
              <SelectTrigger id={id(field.key)} data-testid={id(field.key)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((option) => (
                  <SelectItem key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      case 'text':
        return (
          <div key={field.key} className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={id(field.key)}>{field.label}</Label>
            <Input
              id={id(field.key)}
              data-testid={id(field.key)}
              value={String(value ?? '')}
              maxLength={field.max + 20}
              placeholder={field.placeholder}
              onChange={(event) => set(field.key, event.target.value)}
              aria-invalid={!!error}
            />
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              field.help && <p className="text-xs text-muted-foreground">{field.help}</p>
            )}
          </div>
        )
      case 'color': {
        const color = String(value ?? '#000000FF')
        const alpha = colorAlpha(color)
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={id(field.key)}>{field.label}</Label>
            <div className="flex items-center gap-2">
              <input
                id={id(field.key)}
                data-testid={id(field.key)}
                type="color"
                value={colorHex(color).toLowerCase()}
                onChange={(event) => set(field.key, withAlpha(event.target.value, alpha))}
                className="h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                aria-label={`Couleur ${field.label.toLowerCase()}`}
              />
              <Slider
                min={0}
                max={100}
                step={5}
                value={[alpha]}
                onValueChange={([next]) => set(field.key, withAlpha(color, next))}
                aria-label={`Opacité ${field.label.toLowerCase()}`}
                className="min-w-0 flex-1"
              />
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{alpha} %</span>
            </div>
          </div>
        )
      }
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!hasErrors) onSave(parsed)
      }}
      data-testid={`overlay-settings-${widget}`}
    >
      {SECTIONS[widget].map((section, index) => {
        const fields = section.fields.filter((field) => {
          const dependsOn = DEPENDS_ON[field.key]
          return !dependsOn || draft[dependsOn] === true
        })
        return (
          <fieldset key={section.title ?? index} className="space-y-3">
            {section.title && <legend className="mb-1 text-sm font-semibold">{section.title}</legend>}
            <div className="grid gap-3 sm:grid-cols-2">{fields.map(renderField)}</div>
          </fieldset>
        )
      })}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(DEFAULT_OVERLAY_SETTINGS[widget] as unknown as Record<string, unknown>)
            setNumbers({})
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" /> Valeurs par défaut
        </Button>
        <Button type="submit" size="sm" disabled={saving || hasErrors || !dirty} data-testid={`overlay-save-${widget}`}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Enregistrer
        </Button>
      </div>
    </form>
  )
}
