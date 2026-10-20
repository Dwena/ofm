'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { OverlayStatus } from '@/lib/overlay-state'

interface OverlayFrameProps {
  widget: string
  status: OverlayStatus
  preview: boolean
  children: ReactNode
  /** Placeholder shown in preview mode only, when the widget has nothing to show */
  emptyHint?: string | null
  className?: string
  style?: CSSProperties
}

const STATUS_MESSAGES: Partial<Record<OverlayStatus, { title: string; text: string }>> = {
  revoked: {
    title: 'Lien de widget régénéré',
    text: 'Cette URL ne fonctionne plus. Copiez la nouvelle URL depuis FanVIP › Widgets OBS et mettez à jour la source Navigateur.',
  },
  invalid: {
    title: 'Lien de widget invalide',
    text: 'Cette URL ne correspond à aucun widget (lien régénéré ?). Copiez l’URL depuis FanVIP › Widgets OBS.',
  },
}

/**
 * Full-viewport, transparent frame of an overlay page: checkerboard and
 * hints in preview mode, error card when the URL no longer works
 */
export function OverlayFrame({ widget, status, preview, children, emptyHint, className, style }: OverlayFrameProps) {
  const error = STATUS_MESSAGES[status]
  return (
    <div
      className={`fixed inset-0 overflow-hidden ${preview ? 'ov-checkerboard' : ''} ${className ?? ''}`}
      style={style}
      data-testid="overlay-root"
      data-overlay-widget={widget}
      data-overlay-status={status}
    >
      {error ? (
        <div className="flex h-full w-full items-center justify-center p-4">
          <div
            role="alert"
            data-testid="overlay-error"
            className="max-w-md rounded-xl border-2 border-red-400 bg-red-950/90 px-5 py-4 text-center text-white shadow-lg"
          >
            <p className="text-lg font-bold">⚠️ {error.title}</p>
            <p className="mt-1 text-sm text-red-100">{error.text}</p>
          </div>
        </div>
      ) : (
        <>
          {children}
          {preview && emptyHint && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <p className="rounded-lg bg-black/60 px-3 py-2 text-center text-sm text-white">{emptyHint}</p>
            </div>
          )}
          {preview && status === 'reconnecting' && (
            <p
              data-testid="overlay-reconnecting"
              className="absolute bottom-2 right-2 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-black"
            >
              Reconnexion…
            </p>
          )}
        </>
      )}
    </div>
  )
}
