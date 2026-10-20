/**
 * OBS overlay widgets ("Widgets OBS"): settings, defaults and validation
 * mirrored from the API (apps/api/src/overlays/overlay-settings.ts), template
 * rendering and colors. Pure helpers (no React, no network).
 */

export const OVERLAY_WIDGETS = ['ALERTS', 'GOALS', 'TIP_MENU', 'CHAT', 'REQUESTS'] as const
export type OverlayWidget = (typeof OVERLAY_WIDGETS)[number]

export const isOverlayWidget = (value: unknown): value is OverlayWidget =>
  typeof value === 'string' && (OVERLAY_WIDGETS as readonly string[]).includes(value)

export const OVERLAY_WIDGET_SLUGS: Record<OverlayWidget, string> = {
  ALERTS: 'alerts',
  GOALS: 'goals',
  TIP_MENU: 'menu',
  CHAT: 'chat',
  REQUESTS: 'requests',
}

export const OVERLAY_WIDGET_LABELS: Record<OverlayWidget, { title: string; description: string }> = {
  ALERTS: {
    title: 'Alertes',
    description: 'Pourboires, demandes du menu et paliers atteints, une alerte à la fois avec animation et son.',
  },
  GOALS: { title: 'Objectifs de dons', description: 'Progression du live vers vos paliers.' },
  TIP_MENU: { title: 'Menu des pourboires', description: 'Les actions que vos fans peuvent demander, avec leur prix.' },
  CHAT: { title: 'Chat', description: 'Les derniers messages du chat de votre live.' },
  REQUESTS: { title: 'Demandes', description: 'File des demandes du menu payées pendant le live.' },
}

/** Recommended size of the OBS browser source (same as the API) */
export const OVERLAY_WIDGET_SIZES: Record<OverlayWidget, { width: number; height: number }> = {
  ALERTS: { width: 800, height: 600 },
  GOALS: { width: 800, height: 220 },
  TIP_MENU: { width: 500, height: 700 },
  CHAT: { width: 450, height: 700 },
  REQUESTS: { width: 500, height: 500 },
}

export const ALERT_SOUNDS = ['chime', 'coins', 'fanfare', 'pop'] as const
export type AlertSound = (typeof ALERT_SOUNDS)[number]
export const ALERT_SOUND_LABELS: Record<AlertSound, string> = {
  chime: 'Carillon',
  coins: 'Pièces',
  fanfare: 'Fanfare',
  pop: 'Pop',
}
export const ALERT_ANIMATIONS = ['slide', 'pop', 'fade'] as const
export type AlertAnimation = (typeof ALERT_ANIMATIONS)[number]
export const ALERT_ANIMATION_LABELS: Record<AlertAnimation, string> = {
  slide: 'Glissement',
  pop: 'Rebond',
  fade: 'Fondu',
}

export const MAX_TEMPLATE_LENGTH = 140
export const MAX_TITLE_LENGTH = 60

export interface AlertsSettings {
  minAmount: number
  durationSeconds: number
  soundEnabled: boolean
  soundVolume: number
  sound: AlertSound
  animation: AlertAnimation
  textTemplate: string
  showMessage: boolean
  menuRequestEnabled: boolean
  menuRequestTemplate: string
  goalReachedEnabled: boolean
  goalReachedTemplate: string
  textColor: string
  accentColor: string
  backgroundColor: string
  fontSize: number
}

export interface GoalsSettings {
  layout: 'bar' | 'list'
  show: 'next' | 'all'
  showAmounts: boolean
  title: string
  textColor: string
  accentColor: string
  backgroundColor: string
  fontSize: number
}

export interface TipMenuSettings {
  columns: 1 | 2
  maxItems: number
  title: string
  showDescriptions: boolean
  textColor: string
  accentColor: string
  backgroundColor: string
  fontSize: number
}

export interface ChatSettings {
  maxMessages: number
  hideAfterSeconds: number
  tipsOnly: boolean
  showAvatars: boolean
  fontSize: number
  textColor: string
  accentColor: string
  backgroundColor: string
}

export interface RequestsSettings {
  includeDone: boolean
  maxItems: number
  title: string
  textColor: string
  accentColor: string
  backgroundColor: string
  fontSize: number
}

export interface OverlaySettingsMap {
  ALERTS: AlertsSettings
  GOALS: GoalsSettings
  TIP_MENU: TipMenuSettings
  CHAT: ChatSettings
  REQUESTS: RequestsSettings
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettingsMap = {
  ALERTS: {
    minAmount: 1,
    durationSeconds: 6,
    soundEnabled: true,
    soundVolume: 0.6,
    sound: 'chime',
    animation: 'pop',
    textTemplate: '{name} a envoyé {amount} !',
    showMessage: true,
    menuRequestEnabled: true,
    menuRequestTemplate: '{name} a demandé : {item}',
    goalReachedEnabled: true,
    goalReachedTemplate: '🎯 Palier atteint : {amount} — {label}',
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#111827D9',
    fontSize: 34,
  },
  GOALS: {
    layout: 'bar',
    show: 'all',
    showAmounts: true,
    title: 'Objectifs de dons',
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#111827B3',
    fontSize: 20,
  },
  TIP_MENU: {
    columns: 1,
    maxItems: 8,
    title: 'Menu des pourboires',
    showDescriptions: false,
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#111827B3',
    fontSize: 20,
  },
  CHAT: {
    maxMessages: 10,
    hideAfterSeconds: 0,
    tipsOnly: false,
    showAvatars: true,
    fontSize: 18,
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#11182799',
  },
  REQUESTS: {
    includeDone: false,
    maxItems: 5,
    title: 'Demandes du menu',
    textColor: '#FFFFFFFF',
    accentColor: '#F472B6FF',
    backgroundColor: '#111827B3',
    fontSize: 20,
  },
}

// ---- Field rules (same bounds as the API) ------------------------------------

export type FieldRule =
  | { kind: 'number'; min: number; max: number; integer?: boolean }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: readonly (string | number)[] }
  | { kind: 'text'; max: number; allowEmpty?: boolean }
  | { kind: 'color' }

const num = (min: number, max: number, integer = false): FieldRule => ({ kind: 'number', min, max, integer })
const bool: FieldRule = { kind: 'boolean' }
const oneOf = (values: readonly (string | number)[]): FieldRule => ({ kind: 'enum', values })
const text = (max: number, allowEmpty = false): FieldRule => ({ kind: 'text', max, allowEmpty })
const color: FieldRule = { kind: 'color' }
const COLORS = { textColor: color, accentColor: color, backgroundColor: color }

export const OVERLAY_SETTING_RULES: { [W in OverlayWidget]: Record<keyof OverlaySettingsMap[W], FieldRule> } = {
  ALERTS: {
    minAmount: num(0, 10000),
    durationSeconds: num(3, 20, true),
    soundEnabled: bool,
    soundVolume: num(0, 1),
    sound: oneOf(ALERT_SOUNDS),
    animation: oneOf(ALERT_ANIMATIONS),
    textTemplate: text(MAX_TEMPLATE_LENGTH),
    showMessage: bool,
    menuRequestEnabled: bool,
    menuRequestTemplate: text(MAX_TEMPLATE_LENGTH),
    goalReachedEnabled: bool,
    goalReachedTemplate: text(MAX_TEMPLATE_LENGTH),
    ...COLORS,
    fontSize: num(16, 72, true),
  },
  GOALS: {
    layout: oneOf(['bar', 'list']),
    show: oneOf(['next', 'all']),
    showAmounts: bool,
    title: text(MAX_TITLE_LENGTH, true),
    ...COLORS,
    fontSize: num(12, 48, true),
  },
  TIP_MENU: {
    columns: oneOf([1, 2]),
    maxItems: num(1, 20, true),
    title: text(MAX_TITLE_LENGTH, true),
    showDescriptions: bool,
    ...COLORS,
    fontSize: num(12, 48, true),
  },
  CHAT: {
    maxMessages: num(1, 50, true),
    hideAfterSeconds: num(0, 600, true),
    tipsOnly: bool,
    showAvatars: bool,
    fontSize: num(12, 48, true),
    ...COLORS,
  },
  REQUESTS: {
    includeDone: bool,
    maxItems: num(1, 20, true),
    title: text(MAX_TITLE_LENGTH, true),
    ...COLORS,
    fontSize: num(12, 48, true),
  },
}

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

/** French error of one value, null when valid */
export function fieldError(rule: FieldRule, value: unknown): string | null {
  switch (rule.kind) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Nombre invalide.'
      if (rule.integer && !Number.isInteger(value)) return 'Nombre entier attendu.'
      if (value < rule.min || value > rule.max) {
        return `Entre ${rule.min.toLocaleString('fr-FR')} et ${rule.max.toLocaleString('fr-FR')}.`
      }
      return null
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Valeur invalide.'
    case 'enum':
      return rule.values.includes(value as string | number) ? null : 'Choix invalide.'
    case 'text': {
      if (typeof value !== 'string') return 'Texte invalide.'
      const trimmed = value.trim()
      if (!trimmed && !rule.allowEmpty) return 'Ce texte ne peut pas être vide.'
      if (trimmed.length > rule.max) return `${rule.max} caractères maximum.`
      return null
    }
    case 'color':
      return typeof value === 'string' && COLOR_PATTERN.test(value) ? null : 'Couleur invalide.'
  }
}

/** French errors of a widget's settings form, by field (empty when valid) */
export function validateOverlaySettings<W extends OverlayWidget>(
  widget: W,
  settings: OverlaySettingsMap[W],
): Partial<Record<keyof OverlaySettingsMap[W], string>> {
  const rules = OVERLAY_SETTING_RULES[widget] as Record<string, FieldRule>
  const errors: Record<string, string> = {}
  for (const [key, rule] of Object.entries(rules)) {
    const error = fieldError(rule, (settings as unknown as Record<string, unknown>)[key])
    if (error) errors[key] = error
  }
  return errors as Partial<Record<keyof OverlaySettingsMap[W], string>>
}

/**
 * Settings received from the API, completed with the defaults (a field
 * missing or invalid never breaks an overlay)
 */
export function withDefaults<W extends OverlayWidget>(widget: W, settings: unknown): OverlaySettingsMap[W] {
  const defaults = DEFAULT_OVERLAY_SETTINGS[widget] as unknown as Record<string, unknown>
  const rules = OVERLAY_SETTING_RULES[widget] as Record<string, FieldRule>
  const source = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const result: Record<string, unknown> = { ...defaults }
  for (const [key, rule] of Object.entries(rules)) {
    if (key in source && fieldError(rule, source[key]) === null) result[key] = source[key]
  }
  return result as unknown as OverlaySettingsMap[W]
}

/**
 * Query parameters of an overlay URL overriding its settings for quick tests
 * (e.g. `?fontSize=48&animation=slide&soundEnabled=0`). Invalid values are
 * ignored. `preview` is not a setting.
 */
export function applyQueryOverrides<W extends OverlayWidget>(
  widget: W,
  settings: OverlaySettingsMap[W],
  params: URLSearchParams | null | undefined,
): OverlaySettingsMap[W] {
  if (!params) return settings
  const rules = OVERLAY_SETTING_RULES[widget] as Record<string, FieldRule>
  const result: Record<string, unknown> = { ...settings }
  params.forEach((raw, key) => {
    const rule = rules[key]
    if (!rule) return
    let value: unknown = raw
    if (rule.kind === 'number' || (rule.kind === 'enum' && typeof rule.values[0] === 'number')) {
      value = Number(raw)
    } else if (rule.kind === 'boolean') {
      value = raw === '1' || raw === 'true' ? true : raw === '0' || raw === 'false' ? false : raw
    } else if (rule.kind === 'color' && /^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(raw)) {
      // `#` must be encoded in a URL: accept the bare hex
      value = `#${raw}`
    }
    if (fieldError(rule, value) === null) result[key] = value
  })
  return result as unknown as OverlaySettingsMap[W]
}

// ---- Rendering -------------------------------------------------------------

/** "10 €", "12,50 €" */
export function formatOverlayEuros(amount: number) {
  const decimals = Number.isInteger(amount) ? 0 : 2
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)
}

/**
 * Fill `{name}`, `{amount}`... in a template. Plain text: the result is
 * rendered by React (escaped), never as HTML. Unknown placeholders are kept.
 */
export function renderTemplate(template: string, variables: Record<string, string | number | null | undefined>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = variables[key]
    return value === undefined || value === null ? match : String(value)
  })
}

/** `#RRGGBB` / `#RRGGBBAA` to a CSS rgba() color (transparent when invalid) */
export function hexToRgba(hex: string) {
  if (!COLOR_PATTERN.test(hex)) return 'rgba(0, 0, 0, 0)'
  const value = hex.slice(1)
  const channel = (index: number) => parseInt(value.slice(index, index + 2), 16)
  const alpha = value.length === 8 ? Math.round((channel(6) / 255) * 1000) / 1000 : 1
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`
}

/** `#RRGGBB` part of a color (for <input type="color">) */
export const colorHex = (hex: string) => (COLOR_PATTERN.test(hex) ? hex.slice(0, 7).toUpperCase() : '#000000')

/** Opacity 0-100 of a color */
export function colorAlpha(hex: string) {
  if (!COLOR_PATTERN.test(hex) || hex.length === 7) return 100
  return Math.round((parseInt(hex.slice(7, 9), 16) / 255) * 100)
}

/** Color from its `#RRGGBB` part and an opacity 0-100 */
export function withAlpha(hex: string, alphaPercent: number) {
  const alpha = Math.round((Math.min(100, Math.max(0, alphaPercent)) / 100) * 255)
  return `${colorHex(hex)}${alpha.toString(16).padStart(2, '0').toUpperCase()}`
}

/** Overlay URL with `?preview=1` (checkerboard background, hints) */
export const previewUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}preview=1`

/** "https://…/overlay/abcd…wxyz/alerts" with the token masked */
export function maskOverlayUrl(url: string) {
  return url.replace(/(\/overlay\/)([A-Za-z0-9_-]+)/, (_match, prefix: string, token: string) =>
    `${prefix}${token.slice(0, 4)}${'•'.repeat(12)}${token.slice(-2)}`,
  )
}
