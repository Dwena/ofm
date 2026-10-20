import type { Metadata } from 'next'
import { MenuOverlay } from '@/components/overlays/menu-overlay'

export const metadata: Metadata = { title: 'Widget OBS – Menu des pourboires' }

/** OBS browser source (no login: the token of the URL is the credential) */
export default function Page({ params }: { params: { token: string } }) {
  return <MenuOverlay token={params.token} />
}
