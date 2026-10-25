import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/contexts/auth-context'
import { Providers } from './providers'
import { I18nProvider } from '@/components/i18n-provider'
import { AgeGateInterstitial } from '@/components/age-verification/age-gate-interstitial'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'FanVIP - La plateforme des créateurs de contenu',
    template: '%s | FanVIP',
  },
  description: 'Monétisez votre contenu et rapprochez-vous de vos fans',
  applicationName: 'FanVIP',
  // PWA: icons are generated from public/icon.svg (see public/PWA_ICONS_README.md)
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'FanVIP',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  themeColor: '#4f46e5',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <I18nProvider>
            <AuthProvider>
              {children}
              {/* Adult content warning until the visitor's age is verified (SREN law) */}
              <AgeGateInterstitial />
            </AuthProvider>
          </I18nProvider>
        </Providers>
      </body>
    </html>
  )
}
