import type { Metadata } from 'next'
import { GoalsOverlay } from '@/components/overlays/goals-overlay'

export const metadata: Metadata = { title: 'Widget OBS – Objectifs de dons' }

/** OBS browser source (no login: the token of the URL is the credential) */
export default function Page({ params }: { params: { token: string } }) {
  return <GoalsOverlay token={params.token} />
}
