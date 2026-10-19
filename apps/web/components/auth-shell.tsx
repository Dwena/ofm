'use client'

import { ReactNode } from 'react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function AuthShell({ description, children }: { description: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md shadow-2xl border-2">
        <CardHeader className="space-y-1 pb-6">
          <div className="flex items-center justify-center mb-2">
            <CardTitle className="text-4xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              OFM
            </CardTitle>
          </div>
          <CardDescription className="text-center text-base">{description}</CardDescription>
        </CardHeader>
        {children}
      </Card>
    </div>
  )
}

export function AuthMessage({ type, children }: { type: 'error' | 'success'; children: ReactNode }) {
  const styles =
    type === 'error'
      ? 'text-red-500 bg-red-50 dark:bg-red-900/20'
      : 'text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/20'
  return <div className={`p-3 text-sm rounded-md ${styles}`}>{children}</div>
}

const ERROR_TRANSLATIONS: Record<string, string> = {
  'Invalid or expired verification token': 'Ce lien de vérification est invalide ou a expiré.',
  'Invalid or expired reset token': 'Ce lien de réinitialisation est invalide ou a expiré.',
  'Invalid token': 'Lien invalide.',
  'Invalid email address': 'Adresse e-mail invalide.',
  'Password must be at least 8 characters': 'Le mot de passe doit contenir au moins 8 caractères.',
  'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character':
    'Le mot de passe doit contenir une majuscule, une minuscule, un chiffre et un caractère spécial (@$!%*?&).',
  'Invalid 2FA code': 'Code 2FA invalide.',
  '2FA code must be 6 digits': 'Le code 2FA doit contenir 6 chiffres.',
  '2FA setup expired. Please try again.': "La configuration 2FA a expiré. Veuillez recommencer.",
  'Too Many Requests': 'Trop de tentatives. Veuillez réessayer dans une minute.',
  'ThrottlerException: Too Many Requests': 'Trop de tentatives. Veuillez réessayer dans une minute.',
}

/** Extract a user-facing (French) message from an axios error. */
export function getApiErrorMessage(err: any, fallback: string): string {
  const raw = err?.response?.data?.message
  const message = Array.isArray(raw) ? raw[0] : raw
  if (typeof message !== 'string' || !message) {
    return fallback
  }
  return ERROR_TRANSLATIONS[message] ?? message
}
