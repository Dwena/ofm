'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { authApi, usersApi } from '@/lib/api'
import { getHomeRoute, getPathAccess, sanitizeRedirect } from '@/lib/navigation'
import { User } from '@/types'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string, totpCode?: string) => Promise<void>
  register: (email: string, username: string, password: string, role?: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  const isAuthenticated = !!user

  useEffect(() => {
    // Check if user is logged in
    const token = localStorage.getItem('accessToken')
    if (token) {
      loadUser()
    } else {
      setIsLoading(false)
    }
  }, [])

  async function loadUser() {
    try {
      const response = await usersApi.getMe()
      setUser(response.data)
    } catch (error) {
      console.error('Failed to load user:', error)
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
    } finally {
      setIsLoading(false)
    }
  }

  async function login(email: string, password: string, totpCode?: string) {
    const response = await authApi.login({ email, password, totpCode })
    const { user, accessToken, refreshToken } = response.data

    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    setUser(user)

    // Go back to the page that required the login (?redirect=), if this role may see it,
    // otherwise to the role's home page
    const requested = sanitizeRedirect(new URLSearchParams(window.location.search).get('redirect'))
    const target =
      requested && getPathAccess(user.role, requested.split('?')[0]) === 'ok'
        ? requested
        : getHomeRoute(user.role)
    router.push(target)
  }

  async function register(email: string, username: string, password: string, role: string = 'SUBSCRIBER') {
    await authApi.register({ email, username, password, role })
    // Auto-login after registration
    await login(email, password)
  }

  async function logout() {
    try {
      await authApi.logout()
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      // Full page load: drops every cached query of this account (React Query, sockets)
      // and avoids the (app) guard adding ?redirect= to the login URL
      window.location.assign('/login')
    }
  }

  async function refreshUser() {
    await loadUser()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
