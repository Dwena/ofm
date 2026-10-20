import { api } from './api'
import type { OverlaySettingsMap, OverlayWidget } from './overlay-widgets'

export * from './overlay-widgets'

/** One widget of GET /overlays/me */
export interface OwnOverlayWidget<W extends OverlayWidget = OverlayWidget> {
  widget: W
  slug: string
  /** Secret URL to paste in OBS (contains the overlay token) */
  url: string
  /** Recommended size of the OBS browser source */
  width: number
  height: number
  settings: OverlaySettingsMap[W]
}

export interface OwnOverlays {
  token: string
  baseUrl: string
  createdAt: string
  rotatedAt: string | null
  widgets: OwnOverlayWidget[]
}

export const OVERLAY_TEST_EVENTS = ['alert', 'menu-request', 'goal-reached', 'chat'] as const
export type OverlayTestEvent = (typeof OVERLAY_TEST_EVENTS)[number]

export const OVERLAY_TEST_LABELS: Record<OverlayTestEvent, string> = {
  alert: 'Tester l’alerte',
  'menu-request': 'Tester une demande du menu',
  'goal-reached': 'Tester un palier atteint',
  chat: 'Tester un message',
}

export const overlaysApi = {
  getMine: () => api.get<OwnOverlays>('/overlays/me'),
  /** New URLs: the old ones stop working (OBS sources must be updated) */
  rotateToken: () => api.post<OwnOverlays>('/overlays/me/rotate-token'),
  updateWidget: <W extends OverlayWidget>(widget: W, settings: Partial<OverlaySettingsMap[W]>) =>
    api.put<{ widget: W; settings: OverlaySettingsMap[W] }>(`/overlays/me/widgets/${widget}`, { settings }),
  /** Fake event shown only by the creator's open overlays */
  sendTest: (event: OverlayTestEvent) =>
    api.post<{ sent: boolean; event: OverlayTestEvent; overlaysConnected: boolean }>(`/overlays/me/test/${event}`),
}

/** French message of an overlays endpoint error */
export function overlayErrorMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } })?.response
  if (response?.status === 429) return 'Trop de tests d’affilée : patientez quelques secondes.'
  const raw = response?.data?.message
  const message = Array.isArray(raw) ? raw[0] : raw
  if (typeof message !== 'string') return fallback
  if (/must be between ([\d.]+) and ([\d.]+)/.test(message)) {
    const [, min, max] = message.match(/must be between ([\d.]+) and ([\d.]+)/)!
    return `Une valeur doit être comprise entre ${min} et ${max}.`
  }
  if (/color/i.test(message)) return 'Une couleur est invalide.'
  if (/at most (\d+) characters/.test(message)) return `Un texte est trop long (${message.match(/at most (\d+)/)![1]} caractères maximum).`
  if (/should not be empty/.test(message)) return 'Un texte ne peut pas être vide.'
  return fallback
}
