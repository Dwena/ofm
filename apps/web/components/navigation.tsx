'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Home,
  Upload,
  Users,
  DollarSign,
  Settings,
  LogOut,
  MessageSquare,
  BarChart3
} from 'lucide-react'

export function Navigation() {
  const { user, logout } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  if (!user) return null

  const isCreator = user.role === 'CREATOR'

  const creatorLinks = [
    { href: '/creator/dashboard', label: 'Dashboard', icon: Home },
    { href: '/creator/upload', label: 'Upload', icon: Upload },
    { href: '/creator/subscribers', label: 'Abonnés', icon: Users },
    { href: '/creator/earnings', label: 'Revenus', icon: DollarSign },
    { href: '/creator/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/messages', label: 'Messages', icon: MessageSquare },
    { href: '/settings', label: 'Paramètres', icon: Settings },
  ]

  const subscriberLinks = [
    { href: '/feed', label: 'Feed', icon: Home },
    { href: '/subscriptions', label: 'Abonnements', icon: Users },
    { href: '/messages', label: 'Messages', icon: MessageSquare },
    { href: '/settings', label: 'Paramètres', icon: Settings },
  ]

  const links = isCreator ? creatorLinks : subscriberLinks

  return (
    <nav className="border-b bg-background">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link href={isCreator ? '/creator/dashboard' : '/feed'} className="text-2xl font-bold">
              OFM
            </Link>
            <div className="hidden md:flex space-x-4">
              {links.map((link) => {
                const Icon = link.icon
                const isActive = pathname.startsWith(link.href)
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{link.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <Link href="/settings">
              <Avatar>
                <AvatarImage src={user.creatorProfile?.profilePicture || undefined} />
                <AvatarFallback>
                  {user.username.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Link>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Déconnexion
            </Button>
          </div>
        </div>
      </div>
    </nav>
  )
}
