'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, Gift, ListTodo } from 'lucide-react'
import { cn, formatEuros } from '@/lib/utils'
import type { LiveTipState, TipMenuItem } from '@/lib/live-tips'
import { TipGoalProgress } from './tip-goal-progress'
import { TipActionsList } from './tip-actions-list'

interface TipMenuPanelProps {
  state: LiveTipState
  /** Tips allowed (not the creator's own live) */
  canTip: boolean
  currentUserId?: string
  /** Open the tip modal pre-filled with an item */
  onSelectItem: (item: TipMenuItem) => void
  className?: string
}

type Tab = 'menu' | 'requests'

/**
 * Viewer panel under the player: goal progress, tip menu and the requests
 * in progress (collapsible, tabs on every screen size)
 */
export function TipMenuPanel({ state, canTip, currentUserId, onSelectItem, className }: TipMenuPanelProps) {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('menu')

  const hasMenu = state.menu.length > 0
  const hasGoal = !!state.goalAmount
  const pendingCount = state.actions.filter((action) => action.status === 'PENDING').length
  if (!hasMenu && !hasGoal && state.actions.length === 0) return null

  const showTabs = hasMenu || state.actions.length > 0

  return (
    <section className={cn('bg-card text-card-foreground border-t min-w-0', className)} data-testid="tip-menu-panel">
      {hasGoal && (
        <div className="px-3 pt-3 sm:px-4">
          <TipGoalProgress amount={state.goalAmount} label={state.goalLabel} total={state.total} />
        </div>
      )}
      {showTabs && (
        <>
          <div className="flex items-center gap-1 px-2 pt-2 sm:px-3">
            <div role="tablist" aria-label="Pourboires" className="flex min-w-0 flex-1 gap-1">
              <TabButton active={open && tab === 'menu'} onClick={() => { setTab('menu'); setOpen(true) }}>
                <Gift className="h-4 w-4 shrink-0" />
                <span className="truncate">Menu de pourboires</span>
              </TabButton>
              <TabButton active={open && tab === 'requests'} onClick={() => { setTab('requests'); setOpen(true) }}>
                <ListTodo className="h-4 w-4 shrink-0" />
                <span className="truncate">Demandes</span>
                {pendingCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{pendingCount}</span>
                )}
              </TabButton>
            </div>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-label={open ? 'Replier le menu de pourboires' : 'Déplier le menu de pourboires'}
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
            </button>
          </div>
          {open && (
            <div className="max-h-64 overflow-y-auto px-3 pb-3 pt-2 sm:px-4 lg:max-h-48" role="tabpanel">
              {tab === 'menu' ? (
                hasMenu ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {state.menu.map((item) => (
                      <li key={item.id} className="min-w-0">
                        <button
                          type="button"
                          disabled={!canTip}
                          onClick={() => onSelectItem(item)}
                          className="flex w-full items-start gap-2 rounded-lg border p-2 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:cursor-default disabled:hover:border-border disabled:hover:bg-transparent"
                          data-testid="tip-menu-item"
                          aria-label={`${item.label}, ${formatEuros(item.amount)}`}
                        >
                          <span className="text-xl leading-6 shrink-0" aria-hidden>
                            {item.emoji || '🎁'}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium break-words">{item.label}</span>
                            {item.description && (
                              <span className="block text-xs text-muted-foreground break-words">{item.description}</span>
                            )}
                          </span>
                          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                            {formatEuros(item.amount)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Le créateur n’a pas encore de menu de pourboires.</p>
                )
              ) : (
                <TipActionsList actions={state.actions} currentUserId={currentUserId} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
