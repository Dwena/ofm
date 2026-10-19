'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { getHomeRoute, getPathAccess } from '@/lib/navigation'
import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  FileText,
  Shield,
  ScrollText,
  BarChart3,
  Settings,
} from 'lucide-react'

const adminLinks = [
  { href: '/admin', label: 'Tableau de bord', icon: LayoutDashboard, exact: true },
  { href: '/admin/analytics', label: 'Analytique', icon: BarChart3 },
  { href: '/admin/users', label: 'Utilisateurs', icon: Users },
  { href: '/admin/reports', label: 'Signalements', icon: AlertTriangle },
  { href: '/admin/content', label: 'Contenus', icon: FileText },
  { href: '/admin/moderation', label: 'Modération', icon: Shield },
  { href: '/admin/logs', label: 'Journaux', icon: ScrollText },
  { href: '/admin/settings', label: 'Paramètres', icon: Settings },
]

/**
 * Client-side guard for every /admin route: ADMIN users see the whole back-office,
 * MODERATOR users only the reports queue (the other /admin endpoints are ADMIN-only).
 * The API enforces the same rule with RolesGuard.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const allowed = !!user && getPathAccess(user.role, pathname) === 'ok'
  const visibleLinks = adminLinks.filter(({ href }) => user && getPathAccess(user.role, href) === 'ok')

  useEffect(() => {
    if (!isLoading && user && !allowed) {
      router.replace(getHomeRoute(user.role))
    }
  }, [isLoading, user, allowed, router])

  if (isLoading || !user) return null

  if (!allowed) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <Shield className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">Accès réservé à l&apos;équipe de modération</p>
        <p className="text-sm text-muted-foreground">Redirection en cours...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <nav className="flex gap-1 overflow-x-auto border-b pb-2" aria-label="Administration">
        {visibleLinks.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>
      {children}
    </div>
  )
}
