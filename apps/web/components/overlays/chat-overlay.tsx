'use client'

import { useEffect, useRef, useState } from 'react'
import { useOverlay } from '@/hooks/use-overlay'
import { visibleMessages, type OverlayChatMessage } from '@/lib/overlay-state'
import { formatOverlayEuros, hexToRgba } from '@/lib/overlay-widgets'
import { OverlayFrame } from './overlay-frame'

function Avatar({ message, size }: { message: OverlayChatMessage; size: number }) {
  const [failed, setFailed] = useState(false)
  const name = message.displayName || message.username
  if (message.avatar && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote avatars of any host, no Next image config needed
      <img
        src={message.avatar}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-white/20 font-bold uppercase"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {name.slice(0, 1)}
    </span>
  )
}

/**
 * Latest chat lines of the creator's current live, newest at the bottom.
 * With `hideAfterSeconds`, each line fades out that long after it arrived.
 */
export function ChatOverlay({ token }: { token: string }) {
  const { state, settings, preview } = useOverlay(token, 'CHAT')
  const [now, setNow] = useState(() => Date.now())
  // id -> time the line was first shown (history lines: their own time)
  const seenAt = useRef(new Map<string, number>())
  const loaded = useRef(false)

  for (const message of state.messages) {
    if (seenAt.current.has(message.id)) continue
    const sentAt = Date.parse(message.timestamp)
    seenAt.current.set(message.id, !loaded.current && Number.isFinite(sentAt) ? Math.min(sentAt, Date.now()) : Date.now())
  }
  if (state.status === 'connected') loaded.current = true

  const hideAfter = settings.hideAfterSeconds * 1000
  useEffect(() => {
    if (!hideAfter) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hideAfter])

  const messages = visibleMessages(state.messages, settings.tipsOnly, settings.maxMessages)
  const text = hexToRgba(settings.textColor)
  const accent = hexToRgba(settings.accentColor)
  const avatarSize = Math.round(settings.fontSize * 1.6)

  const emptyHint =
    messages.length > 0 || state.status === 'loading'
      ? null
      : state.live
        ? 'Les messages du chat s’afficheront ici'
        : 'Aucun live en cours : le chat s’affichera pendant votre live'

  return (
    <OverlayFrame widget="chat" status={state.status} preview={preview} emptyHint={emptyHint}>
      <ol
        data-testid="overlay-chat"
        className="absolute inset-x-0 bottom-0 flex max-h-full flex-col justify-end gap-2 overflow-hidden p-3"
        style={{ color: text, fontSize: settings.fontSize }}
      >
        {messages.map((message) => {
          const hidden = hideAfter > 0 && now - (seenAt.current.get(message.id) ?? now) > hideAfter
          const name = message.displayName || message.username
          if (message.type === 'SYSTEM') {
            return (
              <li
                key={message.id}
                data-testid="overlay-chat-message"
                data-type="SYSTEM"
                className={`ov-line-in rounded-xl px-3 py-2 text-center font-bold ${hidden ? 'ov-hidden' : ''}`}
                style={{ background: hexToRgba(settings.backgroundColor), color: accent }}
              >
                {message.message}
              </li>
            )
          }
          const isTip = message.type === 'TIP'
          return (
            <li
              key={message.id}
              data-testid="overlay-chat-message"
              data-type={message.type}
              data-test={message.test ? 'true' : undefined}
              className={`ov-line-in flex items-start gap-2 rounded-xl px-3 py-2 ${hidden ? 'ov-hidden' : ''}`}
              style={{
                background: hexToRgba(settings.backgroundColor),
                ...(isTip ? { boxShadow: `inset 0 0 0 2px ${accent}` } : {}),
              }}
            >
              {settings.showAvatars && <Avatar message={message} size={avatarSize} />}
              <p className="min-w-0 break-words leading-snug">
                <span className="font-bold" style={{ color: accent }}>
                  {name}
                </span>
                {isTip && (
                  <span className="ml-1.5 font-extrabold">
                    💸 {formatOverlayEuros(message.tipAmount ?? 0)}
                    {message.menuItemLabel && <span className="font-semibold"> · a demandé : {message.menuItemLabel}</span>}
                  </span>
                )}
                <span className="ml-1.5">{message.message}</span>
              </p>
            </li>
          )
        })}
      </ol>
    </OverlayFrame>
  )
}
