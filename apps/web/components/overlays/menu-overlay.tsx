'use client'

import { useOverlay } from '@/hooks/use-overlay'
import { formatOverlayEuros, hexToRgba } from '@/lib/overlay-widgets'
import { OverlayFrame } from './overlay-frame'

/**
 * The creator's tip menu (shown with or without a live)
 */
export function MenuOverlay({ token }: { token: string }) {
  const { state, settings, preview } = useOverlay(token, 'TIP_MENU')
  const items = state.menu.filter((item) => item.isActive !== false).slice(0, settings.maxItems)
  const text = hexToRgba(settings.textColor)
  const accent = hexToRgba(settings.accentColor)

  return (
    <OverlayFrame
      widget="menu"
      status={state.status}
      preview={preview}
      emptyHint={state.status !== 'loading' && items.length === 0 ? 'Votre menu des pourboires est vide' : null}
    >
      {items.length > 0 && (
        <div
          data-testid="overlay-menu"
          className="m-3 rounded-2xl px-5 py-4 ov-fade-in"
          style={{ background: hexToRgba(settings.backgroundColor), color: text, fontSize: settings.fontSize }}
        >
          {settings.title && (
            <p className="mb-3 font-bold leading-tight" style={{ color: accent }}>
              {settings.title}
            </p>
          )}
          <ul className={`grid gap-x-5 gap-y-2 ${settings.columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {items.map((item) => (
              <li key={item.id} data-testid="overlay-menu-item" className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {item.emoji && <span className="mr-1.5">{item.emoji}</span>}
                    {item.label}
                  </span>
                  <span className="shrink-0 font-extrabold tabular-nums" style={{ color: accent }}>
                    {formatOverlayEuros(item.amount)}
                  </span>
                </div>
                {settings.showDescriptions && item.description && (
                  <p className="truncate opacity-75" style={{ fontSize: Math.round(settings.fontSize * 0.7) }}>
                    {item.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </OverlayFrame>
  )
}
