/**
 * "Diffuser avec OBS": the creator's LiveKit Ingress (server URL + stream key
 * that stay the same from one live to the next), as returned by
 * GET /streaming/me/ingress. Pure data and helpers (unit tested).
 */

export type LiveSource = 'BROWSER' | 'OBS'
export type IngressInputType = 'WHIP' | 'RTMP'
export type ObsStatus = 'offline' | 'connecting' | 'live'

export interface LiveIngress {
  inputType: IngressInputType
  /** OBS "Serveur" */
  serverUrl: string
  /** RTMP stream key / WHIP bearer token (secret) */
  streamKey: string
  status: ObsStatus
  /** Live receiving OBS's video, null when no live is bound */
  streamId: string | null
  /** WHIP: OBS's encoding is forwarded as is */
  bypassTranscoding: boolean
  updatedAt: string
}

/** API error codes of the ingress endpoints */
export const INGRESS_UNAVAILABLE = 'INGRESS_UNAVAILABLE'
export const INGRESS_SERVICE_UNREACHABLE = 'INGRESS_SERVICE_UNREACHABLE'

export const OBS_STATUS_LABELS: Record<ObsStatus, string> = {
  offline: 'Hors ligne',
  connecting: 'Connexion…',
  live: 'En direct',
}

export const OBS_STATUS_DESCRIPTIONS: Record<ObsStatus, string> = {
  offline: 'OBS n’envoie rien pour le moment. Cliquez sur « Démarrer le streaming » dans OBS.',
  connecting: 'OBS est connecté, la vidéo arrive…',
  live: 'OBS envoie votre vidéo.',
}

/**
 * Badge text: "En direct" only when the video reaches a live in progress;
 * a signal received outside a live (OBS started before "Lancer le live") is
 * only a test of the settings
 */
export function obsStatusLabel(status: ObsStatus, boundToLive: boolean): string {
  if (status === 'live' && !boundToLive) return 'Signal reçu'
  return OBS_STATUS_LABELS[status]
}

export function isObsStatus(value: unknown): value is ObsStatus {
  return value === 'offline' || value === 'connecting' || value === 'live'
}

export const INPUT_TYPE_OPTIONS: { value: IngressInputType; label: string; badge?: string; description: string }[] = [
  {
    value: 'WHIP',
    label: 'WHIP',
    badge: 'Recommandé',
    description: 'OBS 30 ou plus récent. Latence inférieure à la seconde, votre vidéo est diffusée telle quelle.',
  },
  {
    value: 'RTMP',
    label: 'RTMP',
    badge: 'Compatible',
    description:
      'Tous les logiciels (OBS, Streamlabs, vMix…). Quelques secondes de latence, plusieurs qualités proposées aux spectateurs.',
  },
]

/** "R4nP••••••••" : the key stays hidden unless the creator asks to see it */
export function maskSecret(secret: string, visible = 4): string {
  if (!secret) return ''
  if (secret.length <= visible) return '•'.repeat(secret.length)
  return `${secret.slice(0, visible)}${'•'.repeat(Math.max(8, secret.length - visible))}`
}

/** French message of an ingress API error (null when it is not one) */
export function ingressErrorMessage(error: unknown): string | null {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } })?.response
  const raw = response?.data?.message
  const code = Array.isArray(raw) ? raw[0] : raw
  if (code === INGRESS_UNAVAILABLE) {
    return 'La diffusion avec OBS nécessite le serveur vidéo LiveKit, qui n’est pas configuré sur cette plateforme.'
  }
  if (code === INGRESS_SERVICE_UNREACHABLE || response?.status === 503) {
    return 'Le service de réception OBS (LiveKit Ingress) ne répond pas. Réessayez dans un instant.'
  }
  return null
}

/** The ingress endpoint answered "not available here" (P2P mode) */
export function isIngressUnavailable(error: unknown): boolean {
  const raw = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return (Array.isArray(raw) ? raw[0] : raw) === INGRESS_UNAVAILABLE
}

export interface ObsSetupStep {
  title: string
  detail: string
  /** Value to copy for this step (server URL / key), shown next to it */
  copy?: 'serverUrl' | 'streamKey'
}

/** Step-by-step OBS configuration for the chosen protocol */
export function obsSetupSteps(inputType: IngressInputType): ObsSetupStep[] {
  if (inputType === 'WHIP') {
    return [
      { title: 'Ouvrez OBS Studio (version 30 ou plus récente)', detail: 'Menu Fichier → Paramètres → onglet « Stream ».' },
      { title: 'Service : « WHIP »', detail: 'Choisissez WHIP dans la liste « Service ».' },
      { title: 'Serveur', detail: 'Collez l’URL du serveur ci-dessus.', copy: 'serverUrl' },
      { title: 'Bearer Token', detail: 'Collez votre clé de stream (elle reste secrète).', copy: 'streamKey' },
      {
        title: 'Sortie (onglet « Sortie », mode avancé)',
        detail:
          'Encodeur x264 ou NVENC H.264, 1080p ou 720p à 30 i/s, débit 4 000 à 6 000 kbit/s, intervalle d’images clés 2 s, profil « baseline » ou « main », B-frames : 0 (obligatoire en WHIP).',
      },
      {
        title: 'Audio',
        detail: 'OBS envoie l’audio en Opus automatiquement avec WHIP : rien à régler.',
      },
      {
        title: 'Lancez le live sur FanVIP en mode OBS, puis « Démarrer le streaming » dans OBS',
        detail: 'Le statut passe à « Connexion… » puis « En direct » : vos spectateurs vous voient.',
      },
    ]
  }
  return [
    { title: 'Ouvrez OBS (ou votre logiciel de diffusion)', detail: 'Menu Fichier → Paramètres → onglet « Stream ».' },
    { title: 'Service : « Personnalisé… »', detail: 'Choisissez « Personnalisé… » dans la liste « Service ».' },
    { title: 'Serveur', detail: 'Collez l’URL du serveur ci-dessus.', copy: 'serverUrl' },
    { title: 'Clé de stream', detail: 'Collez votre clé de stream (elle reste secrète).', copy: 'streamKey' },
    {
      title: 'Sortie (onglet « Sortie », mode avancé)',
      detail:
        'Encodeur x264 ou NVENC H.264, 1080p ou 720p à 30 i/s, débit 4 500 à 6 000 kbit/s (CBR), intervalle d’images clés 2 s, audio AAC 128 à 160 kbit/s.',
    },
    {
      title: 'Lancez le live sur FanVIP en mode OBS, puis « Démarrer le streaming » dans OBS',
      detail: 'Le statut passe à « Connexion… » puis « En direct » (quelques secondes de latence en RTMP).',
    },
  ]
}
