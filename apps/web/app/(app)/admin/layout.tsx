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
  BarChart3,
  Settings,
  ClipboardCheck,
  ShieldCheck,
  UsersRound,
  Landmark,
  Banknote,
} from 'lucide-react'

type BackOfficeRole = 'ADMIN' | 'MODERATOR'

const adminLinks: {
  href: string
  label: string
  icon: typeof Users
  exact?: boolean
  roles: BackOfficeRole[]
}[] = [
  { href: '/admin', label: 'Tableau de bord', icon: LayoutDashboard, exact: true, roles: ['ADMIN'] },
  { href: '/admin/analytics', label: 'Analytique', icon: BarChart3, roles: ['ADMIN'] },
  { href: '/admin/users', label: 'Utilisateurs', icon: Users, roles: ['ADMIN'] },
  { href: '/admin/reports', label: 'Signalements', icon: AlertTriangle, roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/content', label: 'Contenus', icon: FileText, roles: ['ADMIN'] },
  { href: '/admin/moderation', label: 'Modération', icon: Shield, exact: true, roles: ['ADMIN', 'MODERATOR'] },
  // Compliance queues (card network rules): content reviewed before publication,
  // identity of creators and co-performers
  { href: '/admin/moderation/review', label: 'Validation contenus', icon: ClipboardCheck, roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/moderation/kyc', label: 'Identités', icon: ShieldCheck, roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/moderation/co-performers', label: 'Co-participants', icon: UsersRound, roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/logs', label: 'Journaux', icon: ScrollText, roles: ['ADMIN'] },
  { href: '/admin/payouts', label: 'Virements', icon: Banknote, roles: ['ADMIN'] },
  { href: '/admin/tax', label: 'Fiscalité', icon: Landmark, roles: ['ADMIN'] },
  { href: '/admin/settings', label: 'Paramètres', icon: Settings, roles: ['ADMIN'] },
]

const isActive = (pathname: string, href: string, exact?: boolean) =>
  exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

/**
 * Client-side guard for every /admin route. ADMIN sees the whole back-office;
 * MODERATOR only the report queue and moderation pages (the API enforces the
 * same rules with RolesGuard and answers 403 otherwise).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const role = user?.role === 'ADMIN' || user?.role === 'MODERATOR' ? (user.role as BackOfficeRole) : null
  const links = role ? adminLinks.filter((link) => link.roles.includes(role)) : []
  const current = adminLinks.find((link) => isActive(pathname, link.href, link.exact))
  const allowed = !!role && !!current && current.roles.includes(role)

  useEffect(() => {
    if (isLoading || !user) return
    if (!role) {
      router.replace('/')
    } else if (!allowed) {
      // Moderators landing on an admin-only page go to their queue
      router.replace(role === 'MODERATOR' ? '/admin/reports' : '/admin')
    }
  }, [isLoading, user, role, allowed, router])

  if (isLoading || !user) return null

  if (!allowed) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <Shield className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">
          {role ? 'Section réservée aux administrateurs' : 'Accès réservé à l’équipe de modération'}
        </p>
        <p className="text-sm text-muted-foreground">Redirection en cours...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 pb-2 sm:mx-0 sm:px-0" aria-label="Administration">
        {links.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(pathname, href, exact)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
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
