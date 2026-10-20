'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import NotificationsDropdown from '@/components/social/notifications-dropdown'
import { ThemeSubMenu } from '@/components/theme-toggle'
import { LanguageSubMenu } from '@/components/language-selector'
import { useTranslation } from '@/components/i18n-provider'
import { cn } from '@/lib/utils'
import { BRAND_NAME, Logo } from '@/components/brand/logo'
import {
  getHomeRoute,
  getRoleNavigation,
  isLinkActive,
  type NavLinkItem,
} from '@/lib/navigation'
import {
  ChevronDown,
  Loader2,
  LogOut,
  Menu,
  Settings,
  UserCircle,
  UserCog,
  X,
} from 'lucide-react'

const testId = (href: string) => `nav-link-${href.replace(/^\//, '').replace(/\//g, '-')}`

export function Navigation() {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const pathname = usePathname() || '/'
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const nav = useMemo(() => getRoleNavigation(user?.role), [user?.role])

  // Close the drawer whenever the route changes
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  if (!user) return null

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    // logout() clears the session and reloads on /login: keep the spinner until then
    await logout()
  }

  const primaryHrefs = new Set(nav.primary.map((l) => l.href))
  const moreLinks = nav.sections
    .flatMap((s) => s.links)
    .filter((l, i, all) => !primaryHrefs.has(l.href) && all.findIndex((o) => o.href === l.href) === i)
  const moreActive = moreLinks.some((l) => isLinkActive(pathname, l))

  const displayName = user.displayName || user.username
  const initials = displayName.substring(0, 2).toUpperCase()
  const isCreator = user.role === 'CREATOR'

  const linkLabel = (item: NavLinkItem) => t.shell[item.labelKey]

  return (
    <nav
      className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      data-testid="main-nav"
    >
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 lg:gap-6">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={t.shell.openMenu}
              aria-expanded={mobileOpen}
              data-testid="mobile-menu-button"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <Link href={getHomeRoute(user.role)} aria-label={BRAND_NAME} data-testid="nav-logo">
              <Logo className="text-xl" markClassName="h-8 w-8" />
            </Link>
            <div className="hidden items-center gap-1 lg:flex">
              {nav.primary.map((item) => {
                const Icon = item.icon
                const active = isLinkActive(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={linkLabel(item)}
                    aria-current={active ? 'page' : undefined}
                    data-testid={testId(item.href)}
                    className={cn(
                      'flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="sr-only xl:not-sr-only">{linkLabel(item)}</span>
                  </Link>
                )
              })}
              {moreLinks.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn('gap-1 text-muted-foreground', moreActive && 'bg-accent text-accent-foreground')}
                      data-testid="nav-more-button"
                    >
                      {t.shell.more}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {moreLinks.map((item) => {
                      const Icon = item.icon
                      const active = isLinkActive(pathname, item)
                      return (
                        <DropdownMenuItem key={item.href} asChild>
                          <Link
                            href={item.href}
                            data-testid={`nav-more-${testId(item.href)}`}
                            aria-current={active ? 'page' : undefined}
                            className={cn('cursor-pointer', active && 'font-semibold text-primary')}
                          >
                            <Icon className="mr-2 h-4 w-4" />
                            {linkLabel(item)}
                          </Link>
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <NotificationsDropdown />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label={t.shell.accountMenu}
                  data-testid="user-menu-trigger"
                >
                  <Avatar>
                    <AvatarImage src={user.avatar || undefined} alt={displayName} />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-medium">{displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/${user.username}`} className="cursor-pointer" data-testid="user-menu-public-profile">
                    <UserCircle className="mr-2 h-4 w-4" />
                    {t.shell.publicProfile}
                  </Link>
                </DropdownMenuItem>
                {isCreator && (
                  <DropdownMenuItem asChild>
                    <Link href="/creator/profile" className="cursor-pointer" data-testid="user-menu-edit-profile">
                      <UserCog className="mr-2 h-4 w-4" />
                      {t.shell.creatorProfile}
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer" data-testid="user-menu-settings">
                    <Settings className="mr-2 h-4 w-4" />
                    {t.shell.settings}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <ThemeSubMenu />
                <LanguageSubMenu />
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault()
                    handleLogout()
                  }}
                  disabled={loggingOut}
                  className="cursor-pointer text-destructive focus:text-destructive"
                  data-testid="logout-button"
                >
                  {loggingOut ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 h-4 w-4" />
                  )}
                  {loggingOut ? t.shell.loggingOut : t.shell.logout}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Mobile / tablet drawer */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg:hidden" />
          <DialogPrimitive.Content
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-background shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left lg:hidden"
            data-testid="mobile-menu"
          >
            <div className="flex h-16 items-center justify-between border-b px-4">
              <DialogPrimitive.Title asChild>
                <Link href={getHomeRoute(user.role)} aria-label={BRAND_NAME}>
                  <Logo className="text-xl" markClassName="h-8 w-8" />
                </Link>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">{t.shell.sectionMain}</DialogPrimitive.Description>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label={t.shell.closeMenu}>
                  <X className="h-5 w-5" />
                </Button>
              </DialogPrimitive.Close>
            </div>

            <div className="flex items-center gap-3 border-b px-4 py-3">
              <Avatar>
                <AvatarImage src={user.avatar || undefined} alt={displayName} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <Link
                  href={`/${user.username}`}
                  className="truncate text-xs text-muted-foreground hover:underline"
                >
                  {t.shell.publicProfile}
                </Link>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-3">
              {nav.sections.map((section) => (
                <div key={section.titleKey} className="mb-4">
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.shell[section.titleKey]}
                  </p>
                  {section.links.map((item) => {
                    const Icon = item.icon
                    const active = isLinkActive(pathname, item)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        data-testid={`mobile-${testId(item.href)}`}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {linkLabel(item)}
                      </Link>
                    )
                  })}
                </div>
              ))}
            </div>

            <div className="border-t p-3">
              <Button
                variant="ghost"
                className="w-full justify-start text-destructive hover:text-destructive"
                onClick={handleLogout}
                disabled={loggingOut}
                data-testid="mobile-logout-button"
              >
                {loggingOut ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" />
                )}
                {loggingOut ? t.shell.loggingOut : t.shell.logout}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </nav>
  )
}
