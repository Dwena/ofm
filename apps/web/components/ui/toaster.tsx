'use client'

import { X } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div className="fixed bottom-0 right-0 z-[100] flex w-full flex-col gap-2 p-4 sm:max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'relative rounded-md border p-4 pr-8 shadow-lg',
            t.variant === 'destructive'
              ? 'border-destructive bg-destructive text-destructive-foreground'
              : 'bg-background text-foreground'
          )}
        >
          {t.title && <div className="text-sm font-semibold">{t.title}</div>}
          {t.description && <div className="text-sm opacity-90">{t.description}</div>}
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="absolute right-2 top-2 rounded-md p-1 opacity-70 hover:opacity-100"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
