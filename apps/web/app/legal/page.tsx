import { redirect } from 'next/navigation'

/** /legal has no content of its own */
export default function LegalIndexPage() {
  redirect('/legal/mentions-legales')
}
