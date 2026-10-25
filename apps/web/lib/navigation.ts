import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Bell,
  Clapperboard,
  Compass,
  CreditCard,
  DollarSign,
  FileText,
  Landmark,
  Flag,
  Home,
  MonitorPlay,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Receipt,
  Settings,
  Shield,
  Sparkles,
  Upload,
  UserCog,
  Users,
  Wallet,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import type { Translations } from '@/lib/i18n/locales/fr'

export type AppRole = 'SUBSCRIBER' | 'CREATOR' | 'ADMIN' | 'MODERATOR'

export type ShellLabelKey = keyof Translations['shell']

export interface NavLinkItem {
  href: string
  labelKey: ShellLabelKey
  icon: LucideIcon
  /** Only highlight on an exact pathname match (e.g. /admin vs /admin/users) */
  exact?: boolean
}

export interface NavSection {
  titleKey: ShellLabelKey
  links: NavLinkItem[]
}

export interface RoleNavigation {
  /** Links shown directly in the desktop top bar */
  primary: NavLinkItem[]
  /** Everything, grouped: used by the "Plus" menu and the mobile drawer */
  sections: NavSection[]
}

const link = (href: string, labelKey: ShellLabelKey, icon: LucideIcon, exact?: boolean): NavLinkItem => ({
  href,
  labelKey,
  icon,
  exact,
})

const L = {
  feed: link('/feed', 'feed', Home),
  discover: link('/discover', 'discover', Compass),
  lives: link('/live', 'lives', Radio),
  subscriptions: link('/subscriptions', 'subscriptions', Users),
  messages: link('/messages', 'messages', MessageSquare),
  notifications: link('/notifications', 'notifications', Bell),
  settings: link('/settings', 'settings', Settings, true),
  paymentMethods: link('/settings/payment-methods', 'paymentMethods', CreditCard),
  transactions: link('/payments', 'transactions', Receipt),
  wallet: link('/wallet', 'wallet', Wallet),
  creatorDashboard: link('/creator/dashboard', 'creatorDashboard', LayoutDashboard),
  creatorContent: link('/creator/content', 'creatorContent', FileText),
  creatorUpload: link('/creator/upload', 'creatorUpload', Upload),
  creatorStories: link('/creator/stories', 'creatorStories', Sparkles),
  creatorLive: link('/creator/live', 'creatorLive', Clapperboard),
  creatorOverlays: link('/creator/overlays', 'creatorOverlays', MonitorPlay),
  creatorSubscribers: link('/creator/subscriptions', 'creatorSubscribers', Users),
  creatorEarnings: link('/creator/earnings', 'creatorEarnings', DollarSign),
  creatorAnalytics: link('/creator/analytics', 'creatorAnalytics', BarChart3),
  creatorProfile: link('/creator/profile', 'creatorProfile', UserCog),
  creatorTaxProfile: link('/creator/tax-profile', 'creatorTaxProfile', Landmark),
  creatorDocuments: link('/creator/documents', 'creatorDocuments', Receipt),
  creatorVerification: link('/creator/verification', 'creatorVerification', ShieldCheck),
  creatorCoPerformers: link('/creator/co-performers', 'creatorCoPerformers', UsersRound),
  admin: link('/admin', 'admin', Shield),
  reports: link('/admin/reports', 'reports', Flag),
}

const exploreSection: NavSection = {
  titleKey: 'sectionExplore',
  links: [L.feed, L.discover, L.lives, L.subscriptions],
}

const accountSection = (extra: NavLinkItem[] = []): NavSection => ({
  titleKey: 'sectionAccount',
  links: [L.messages, L.notifications, ...extra, L.transactions, L.paymentMethods, L.settings],
})

export function getRoleNavigation(role: string | undefined): RoleNavigation {
  switch (role) {
    case 'CREATOR':
      return {
        primary: [
          L.creatorDashboard,
          L.creatorContent,
          L.creatorUpload,
          L.creatorLive,
          L.creatorSubscribers,
          L.creatorEarnings,
          L.creatorAnalytics,
          L.messages,
        ],
        sections: [
          {
            titleKey: 'sectionCreator',
            links: [
              L.creatorDashboard,
              L.creatorContent,
              L.creatorUpload,
              L.creatorStories,
              L.creatorLive,
              L.creatorOverlays,
              L.creatorSubscribers,
              L.creatorEarnings,
              L.creatorAnalytics,
              L.creatorProfile,
              L.creatorTaxProfile,
              L.creatorDocuments,
              L.creatorVerification,
              L.creatorCoPerformers,
            ],
          },
          { titleKey: 'sectionExplore', links: [L.feed, L.discover, L.lives] },
          accountSection([L.wallet]),
        ],
      }
    case 'ADMIN':
      return {
        primary: [L.admin, L.discover, L.lives, L.messages],
        sections: [
          { titleKey: 'sectionAdmin', links: [L.admin] },
          exploreSection,
          accountSection(),
        ],
      }
    case 'MODERATOR':
      return {
        primary: [L.reports, L.discover, L.lives, L.messages],
        sections: [
          { titleKey: 'sectionAdmin', links: [L.reports] },
          exploreSection,
          accountSection(),
        ],
      }
    default:
      return {
        primary: [L.feed, L.discover, L.lives, L.subscriptions, L.messages],
        sections: [{ titleKey: 'sectionMain', links: exploreSection.links }, accountSection()],
      }
  }
}

/** Landing page of each role after login (and target of the logo) */
export function getHomeRoute(role: string | undefined): string {
  switch (role) {
    case 'ADMIN':
      return '/admin'
    case 'MODERATOR':
      return '/admin/reports'
    case 'CREATOR':
      return '/creator/dashboard'
    default:
      return '/feed'
  }
}

/** Moderators only see the reports queue and moderation pages: other /admin endpoints are ADMIN-only on the API */
const MODERATOR_ADMIN_PATHS = ['/admin/reports', '/admin/moderation']

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export type PathAccess = 'ok' | 'creator-only' | 'staff-only'

/**
 * OBS overlay widgets (/overlay/<token>/<widget>): public pages opened by OBS
 * without a session, never redirected to /login nor gated by role
 */
export function isOverlayPath(pathname: string) {
  return matches(pathname, '/overlay')
}

/** Client-side mirror of the API role guards, used by the (app) layout */
export function getPathAccess(role: string | undefined, pathname: string): PathAccess {
  if (isOverlayPath(pathname)) return 'ok'
  if (matches(pathname, '/creator')) {
    return role === 'CREATOR' ? 'ok' : 'creator-only'
  }
  if (matches(pathname, '/admin')) {
    if (role === 'ADMIN') return 'ok'
    if (role === 'MODERATOR' && MODERATOR_ADMIN_PATHS.some((p) => matches(pathname, p))) return 'ok'
    return 'staff-only'
  }
  return 'ok'
}

export function isLinkActive(pathname: string, item: Pick<NavLinkItem, 'href' | 'exact'>): boolean {
  return item.exact ? pathname === item.href : matches(pathname, item.href)
}

/**
 * Only accept same-origin relative paths as a post-login redirect target
 * (prevents open redirects such as ?redirect=//evil.com).
 */
export function sanitizeRedirect(target: string | null | undefined): string | null {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return null
  if (/^\/(login|register|forgot-password|reset-password|verify-email)(\/|\?|$)/.test(target)) return null
  return target
}

export function buildLoginUrl(returnTo?: string): string {
  const safe = sanitizeRedirect(returnTo)
  return safe && safe !== '/' ? `/login?redirect=${encodeURIComponent(safe)}` : '/login'
}
