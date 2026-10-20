'use client'

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { authApi, usersApi, SESSION_EXPIRED_EVENT } from '@/lib/api'
import { getHomeRoute, getPathAccess, isOverlayPath, sanitizeRedirect } from '@/lib/navigation'
import { User, UserRole } from '@/types'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  /** Logs in and redirects to `redirectTo` (a local path) or to the role's home page */
  login: (email: string, password: string, totpCode?: string, redirectTo?: string | null) => Promise<User>
  register: (email: string, username: string, password: string, role?: string) => Promise<User>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  /** Drops the local session (tokens, user, cached queries) without calling the API */
  clearSession: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/** Landing page of each role once logged in (single source: lib/navigation) */
export function getHomePath(role?: UserRole | string | null): string {
  return getHomeRoute(role ?? undefined)
}

/** Same-origin, non-auth paths only ("/feed"), never "//evil.com" or absolute URLs */
export function getSafeRedirect(path?: string | null): string | null {
  return sanitizeRedirect(path)
}

function clearTokens() {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const queryClient = useQueryClient()

  const isAuthenticated = !!user

  const loadUser = useCallback(async () => {
    try {
      const response = await usersApi.getMe()
      setUser(response.data)
    } catch (error: any) {
      // 401 = the session is gone (the interceptor already tried a refresh).
      // Other errors (network, 503 maintenance...) keep the tokens for a later retry.
      if (error?.response?.status === 401) {
        clearTokens()
      }
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // OBS overlay widgets (/overlay/*) have no session: never load the user there, so a
    // preview iframe never refreshes (and rotates) the creator's single-use refresh token
    if (isOverlayPath(window.location.pathname)) {
      setIsLoading(false)
      return
    }
    // Check if user is logged in
    const token = localStorage.getItem('accessToken')
    if (token) {
      loadUser()
    } else {
      setIsLoading(false)
    }
  }, [loadUser])

  const clearSession = useCallback(() => {
    clearTokens()
    setUser(null)
    queryClient.clear()
  }, [queryClient])

  // Session expired (refresh failed) or logged out in another tab. Protected
  // layouts then send the user to /login since `user` is null.
  useEffect(() => {
    function handleExpired() {
      setUser(null)
      queryClient.clear()
    }
    function handleStorage(event: StorageEvent) {
      if (event.key === 'accessToken' && !event.newValue) handleExpired()
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired)
      window.removeEventListener('storage', handleStorage)
    }
  }, [queryClient])

  const login = useCallback(
    async (email: string, password: string, totpCode?: string, redirectTo?: string | null) => {
      const response = await authApi.login({ email, password, totpCode })
      const { user: loggedUser, accessToken, refreshToken } = response.data

      // Never show the previous account's cached data
      queryClient.clear()
      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refreshToken)

      // The login payload is partial: load the full profile (creatorProfile, kycStatus...)
      let fullUser: User = loggedUser
      try {
        const me = await usersApi.getMe()
        fullUser = me.data
      } catch {
        // e.g. maintenance mode for non-admins: keep the login payload
      }
      setUser(fullUser)

      // Back to the page that required the login if this role may open it, else the role's home
      const requested = getSafeRedirect(redirectTo)
      router.push(
        requested && getPathAccess(fullUser.role, requested.split('?')[0]) === 'ok'
          ? requested
          : getHomePath(fullUser.role),
      )
      return fullUser
    },
    [queryClient, router]
  )

  const register = useCallback(
    async (email: string, username: string, password: string, role: string = 'SUBSCRIBER') => {
      await authApi.register({ email, username, password, role })
      // Auto-login after registration
      try {
        return await login(email, password)
      } catch (error) {
        // The account exists: let the user log in manually instead of re-registering
        router.push('/login')
        throw Object.assign(new Error('Registered but auto-login failed'), { registeredButLoginFailed: true, cause: error })
      }
    },
    [login, router]
  )

  const logout = useCallback(async () => {
    try {
      if (localStorage.getItem('accessToken')) {
        await authApi.logout()
      }
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      clearSession()
      router.push('/login')
    }
  }, [clearSession, router])

  const refreshUser = useCallback(async () => {
    await loadUser()
  }, [loadUser])

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
        clearSession,
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
