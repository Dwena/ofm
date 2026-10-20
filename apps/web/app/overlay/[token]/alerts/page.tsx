import type { Metadata } from 'next'
import { AlertsOverlay } from '@/components/overlays/alerts-overlay'

export const metadata: Metadata = { title: 'Widget OBS – Alertes' }

/** OBS browser source (no login: the token of the URL is the credential) */
export default function Page({ params }: { params: { token: string } }) {
  return <AlertsOverlay token={params.token} />
}
