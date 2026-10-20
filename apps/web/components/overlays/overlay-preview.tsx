'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { maskOverlayUrl, previewUrl } from '@/lib/overlay-widgets'

/**
 * Live preview of an overlay: the real overlay page (`?preview=1`, checkerboard
 * background) in an iframe at its OBS size, scaled down to the card width
 */
export function OverlayPreview({ url, width, height, title }: { url: string; width: number; height: number; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setScale(Math.min(1, element.clientWidth / width))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [width])

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded-lg border" style={{ height: Math.round(height * scale) }}>
      <iframe
        src={previewUrl(url)}
        title={`Aperçu : ${title}`}
        width={width}
        height={height}
        className="origin-top-left border-0"
        style={{ transform: `scale(${scale})`, width, height }}
        data-testid="overlay-preview-frame"
      />
    </div>
  )
}

/**
 * Secret overlay URL, masked by default, with show / copy buttons
 */
export function OverlayUrlField({ url, widget }: { url: string; widget: string }) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast({ title: 'URL copiée', description: 'Collez-la dans une source « Navigateur » d’OBS.' })
    } catch {
      setVisible(true)
      toast({ title: 'Copie impossible', description: 'Sélectionnez l’URL affichée et copiez-la manuellement.', variant: 'destructive' })
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code
        className="min-w-0 flex-1 select-all truncate rounded-md border bg-muted px-2 py-2 text-xs"
        data-testid={`overlay-url-${widget}`}
        title={visible ? url : 'URL masquée'}
      >
        {visible ? url : maskOverlayUrl(url)}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? 'Masquer l’URL' : 'Afficher l’URL'}
        title={visible ? 'Masquer l’URL' : 'Afficher l’URL'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        onClick={copy}
        aria-label="Copier l’URL"
        title="Copier l’URL"
        data-testid={`overlay-copy-${widget}`}
      >
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}
