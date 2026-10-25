import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Vérification de l’âge',
  robots: { index: false, follow: false },
}

/** Public pages (no login): the age verification works for anonymous visitors too */
export default function AgeVerificationLayout({ children }: { children: React.ReactNode }) {
  return children
}
