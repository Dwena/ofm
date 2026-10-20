'use client'

import { useOverlay } from '@/hooks/use-overlay'
import { visibleRequests } from '@/lib/overlay-state'
import { formatOverlayEuros, hexToRgba } from '@/lib/overlay-widgets'
import { OverlayFrame } from './overlay-frame'

const STATUS_ICONS = { PENDING: '⏳', DONE: '✅', SKIPPED: '⏭️' } as const

/**
 * Tip menu requests of the current live (pending first, optionally the done ones)
 */
export function RequestsOverlay({ token }: { token: string }) {
  const { state, settings, preview } = useOverlay(token, 'REQUESTS')
  const requests = visibleRequests(state.actions, settings.includeDone, settings.maxItems)
  const text = hexToRgba(settings.textColor)
  const accent = hexToRgba(settings.accentColor)

  const emptyHint =
    requests.length > 0 || state.status === 'loading'
      ? null
      : state.live
        ? 'Aucune demande en attente'
        : 'Aucun live en cours : les demandes du menu s’afficheront pendant votre live'

  return (
    <OverlayFrame widget="requests" status={state.status} preview={preview} emptyHint={emptyHint}>
      {requests.length > 0 && (
        <div
          data-testid="overlay-requests"
          className="m-3 rounded-2xl px-5 py-4 ov-fade-in"
          style={{ background: hexToRgba(settings.backgroundColor), color: text, fontSize: settings.fontSize }}
        >
          {settings.title && (
            <p className="mb-3 font-bold leading-tight" style={{ color: accent }}>
              {settings.title}
            </p>
          )}
          <ol className="space-y-2">
            {requests.map((request) => {
              const name = request.fromUser.displayName || request.fromUser.username
              const done = request.status !== 'PENDING'
              return (
                <li
                  key={request.id}
                  data-testid="overlay-request"
                  data-status={request.status}
                  className={`ov-line-in ${done ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`min-w-0 truncate font-semibold ${request.status === 'DONE' ? 'line-through' : ''}`}>
                      {STATUS_ICONS[request.status]} {request.label}
                    </span>
                    <span className="shrink-0 tabular-nums font-bold" style={{ color: accent }}>
                      {formatOverlayEuros(request.amount)}
                    </span>
                  </div>
                  <p className="truncate opacity-80" style={{ fontSize: Math.round(settings.fontSize * 0.7) }}>
                    par {name}
                  </p>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </OverlayFrame>
  )
}
