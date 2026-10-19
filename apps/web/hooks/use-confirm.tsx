'use client'

import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  /** `destructive` renders a red confirm button (deletions, bans…) */
  variant?: 'default' | 'destructive'
}

export interface PromptOptions extends ConfirmOptions {
  label?: string
  placeholder?: string
  defaultValue?: string
  /** Disable the confirm button while the field is empty */
  required?: boolean
  multiline?: boolean
}

type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

/**
 * In-app replacement for window.confirm / window.prompt.
 *
 *   const { confirm, prompt } = useConfirm()
 *   if (!(await confirm({ title: 'Supprimer ce palier ?', variant: 'destructive' }))) return
 *   const reason = await prompt({ title: 'Motif', required: true, multiline: true })
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null)
  const [value, setValue] = useState('')
  const stateRef = useRef<DialogState | null>(null)

  const open = useCallback((next: DialogState) => {
    // Settle a dialog that is still open before replacing it
    const previous = stateRef.current
    if (previous) previous.kind === 'confirm' ? previous.resolve(false) : previous.resolve(null)
    stateRef.current = next
    setValue(next.kind === 'prompt' ? next.options.defaultValue ?? '' : '')
    setState(next)
  }, [])

  const close = useCallback((result: 'confirm' | 'cancel', input?: string) => {
    const current = stateRef.current
    if (!current) return
    stateRef.current = null
    setState(null)
    if (current.kind === 'confirm') current.resolve(result === 'confirm')
    else current.resolve(result === 'confirm' ? input ?? '' : null)
  }, [])

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => open({ kind: 'confirm', options, resolve })),
    [open],
  )
  const prompt = useCallback(
    (options: PromptOptions) => new Promise<string | null>((resolve) => open({ kind: 'prompt', options, resolve })),
    [open],
  )

  const options = state?.options
  const promptOptions = state?.kind === 'prompt' ? state.options : null
  const confirmDisabled = !!promptOptions?.required && value.trim() === ''

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      <AlertDialog open={!!state} onOpenChange={(isOpen) => !isOpen && close('cancel')}>
        <AlertDialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!confirmDisabled) close('confirm', value.trim())
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{options?.title}</AlertDialogTitle>
              {options?.description && <AlertDialogDescription>{options.description}</AlertDialogDescription>}
            </AlertDialogHeader>

            {promptOptions && (
              <div className="space-y-2">
                {promptOptions.label && <Label htmlFor="confirm-dialog-input">{promptOptions.label}</Label>}
                {promptOptions.multiline ? (
                  <Textarea
                    id="confirm-dialog-input"
                    autoFocus
                    rows={3}
                    value={value}
                    placeholder={promptOptions.placeholder}
                    onChange={(event) => setValue(event.target.value)}
                  />
                ) : (
                  <Input
                    id="confirm-dialog-input"
                    autoFocus
                    value={value}
                    placeholder={promptOptions.placeholder}
                    onChange={(event) => setValue(event.target.value)}
                  />
                )}
              </div>
            )}

            <AlertDialogFooter>
              <Button type="button" variant="outline" onClick={() => close('cancel')}>
                {options?.cancelText ?? 'Annuler'}
              </Button>
              <Button
                type="submit"
                variant={options?.variant === 'destructive' ? 'destructive' : 'default'}
                disabled={confirmDisabled}
              >
                {options?.confirmText ?? 'Confirmer'}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return context
}
