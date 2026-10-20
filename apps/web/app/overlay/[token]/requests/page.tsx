import type { Metadata } from 'next'
import { RequestsOverlay } from '@/components/overlays/requests-overlay'

export const metadata: Metadata = { title: 'Widget OBS – Demandes' }

/** OBS browser source (no login: the token of the URL is the credential) */
export default function Page({ params }: { params: { token: string } }) {
  return <RequestsOverlay token={params.token} />
}
