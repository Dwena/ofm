'use client'

import { useEffect, useState } from 'react'

export type ToastVariant = 'default' | 'destructive'

export interface ToastOptions {
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

export interface Toast extends ToastOptions {
  id: string
}

const TOAST_LIMIT = 3
const DEFAULT_DURATION = 5000

let toasts: Toast[] = []
const listeners = new Set<(toasts: Toast[]) => void>()
let counter = 0

function emit() {
  listeners.forEach((listener) => listener(toasts))
}

export function dismiss(id: string) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function toast(options: ToastOptions) {
  const id = String(++counter)
  toasts = [{ ...options, id }, ...toasts].slice(0, TOAST_LIMIT)
  emit()
  setTimeout(() => dismiss(id), options.duration ?? DEFAULT_DURATION)
  return { id, dismiss: () => dismiss(id) }
}

export function useToast() {
  const [state, setState] = useState<Toast[]>(toasts)

  useEffect(() => {
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])

  return { toasts: state, toast, dismiss }
}
