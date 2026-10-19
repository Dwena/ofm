'use client'

import { contentApi } from '@/lib/api'
import OneTimeCheckout from '@/components/checkout/one-time-checkout'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface PpvUnlockTarget {
  id: string
  title?: string | null
  // Euros
  ppvPrice: number | string | null
  creator?: { username: string } | null
}

interface PpvUnlockDialogProps {
  content: PpvUnlockTarget | null
  onClose: () => void
  // Called once the payment is confirmed and the content is unlocked
  onUnlocked: () => void
}

/**
 * Pay for a PPV content without leaving the page (saved card or Stripe Elements)
 */
export default function PpvUnlockDialog({ content, onClose, onUnlocked }: PpvUnlockDialogProps) {
  return (
    <Dialog open={!!content} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Débloquer ce contenu</DialogTitle>
          <DialogDescription>
            {content?.title || 'Contenu exclusif'}
            {content?.creator?.username ? ` - @${content.creator.username}` : ''}
          </DialogDescription>
        </DialogHeader>
        {content && (
          <OneTimeCheckout
            key={content.id}
            kind="ppv"
            compact
            amount={Number(content.ppvPrice ?? 0)}
            description={content.title || 'Contenu exclusif'}
            start={async (paymentMethodId) => (await contentApi.unlockPPV(content.id, paymentMethodId)).data}
            confirm={async (paymentIntentId) =>
              (await contentApi.confirmUnlock(content.id, paymentIntentId)).data
            }
            successDelay={1200}
            onSuccess={() => {
              onUnlocked()
              onClose()
            }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
