'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  FileText,
  Shield,
  ScrollText,
} from 'lucide-react'

const adminLinks = [
  { href: '/admin', label: 'Tableau de bord', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Utilisateurs', icon: Users },
  { href: '/admin/reports', label: 'Signalements', icon: AlertTriangle },
  { href: '/admin/content', label: 'Contenus', icon: FileText },
  { href: '/admin/moderation', label: 'Modération', icon: Shield },
  { href: '/admin/logs', label: 'Journaux', icon: ScrollText },
]

/**
 * Client-side guard for every /admin route: only ADMIN users can see the back-office.
 * The API enforces the same rule with RolesGuard.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const isAdmin = user?.role === 'ADMIN'

  useEffect(() => {
    if (!isLoading && user && !isAdmin) {
      router.replace('/')
    }
  }, [isLoading, user, isAdmin, router])

  if (isLoading || !user) return null

  if (!isAdmin) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <Shield className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">Accès réservé aux administrateurs</p>
        <p className="text-sm text-muted-foreground">Redirection en cours...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <nav className="flex gap-1 overflow-x-auto border-b pb-2" aria-label="Administration">
        {adminLinks.map(({ href, label, icon: Icon, exact }) => {
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
