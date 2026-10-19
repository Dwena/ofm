'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

const LOGIN_ERRORS: Record<string, string> = {
  'Invalid credentials': 'Email ou mot de passe incorrect.',
  'Account suspended': 'Votre compte est suspendu.',
  'Account banned': 'Votre compte a été banni.',
  'Too Many Requests': 'Trop de tentatives. Veuillez réessayer dans une minute.',
  'ThrottlerException: Too Many Requests': 'Trop de tentatives. Veuillez réessayer dans une minute.',
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [needs2FA, setNeeds2FA] = useState(false)

  const { login } = useAuth()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email, password, needs2FA ? totpCode : undefined)
    } catch (err: any) {
      const raw = err.response?.data?.message
      const message: string = Array.isArray(raw) ? raw[0] : raw || ''
      if (message === '2FA code required') {
        setNeeds2FA(true)
      } else if (message === 'Invalid 2FA code') {
        setTotpCode('')
        setError('Code 2FA invalide. Réessayez avec un nouveau code.')
      } else {
        setError(LOGIN_ERRORS[message] || message || 'Erreur de connexion')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md shadow-2xl border-2">
        <CardHeader className="space-y-1 pb-6">
          <div className="flex items-center justify-center mb-2">
            <CardTitle className="text-4xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              OFM
            </CardTitle>
          </div>
          <CardDescription className="text-center text-base">
            Connectez-vous à votre compte
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-md">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading || needs2FA}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Mot de passe</label>
                <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                  Mot de passe oublié ?
                </Link>
              </div>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading || needs2FA}
              />
            </div>
            {needs2FA && (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="totpCode">Code 2FA</label>
                <p className="text-sm text-muted-foreground">
                  Saisissez le code à 6 chiffres affiché par votre application d'authentification.
                </p>
                <Input
                  id="totpCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  disabled={loading}
                  maxLength={6}
                  autoFocus
                />
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:underline"
                  onClick={() => {
                    setNeeds2FA(false)
                    setTotpCode('')
                    setError('')
                  }}
                >
                  Utiliser un autre compte
                </button>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-lg py-6"
              disabled={loading}
            >
              {loading ? 'Connexion...' : needs2FA ? 'Vérifier' : 'Se connecter'}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              Pas encore de compte ?{' '}
              <Link href="/register" className="text-primary hover:underline">
                S'inscrire
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
