import type { Metadata } from 'next'
import { ChatOverlay } from '@/components/overlays/chat-overlay'

export const metadata: Metadata = { title: 'Widget OBS – Chat' }

/** OBS browser source (no login: the token of the URL is the credential) */
export default function Page({ params }: { params: { token: string } }) {
  return <ChatOverlay token={params.token} />
}
