'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** Distance from the bottom (px) under which the chat keeps following new messages */
const NEAR_BOTTOM_PX = 80

/**
 * Keep a chat scrolled to the newest message, unless the user scrolled up to
 * read older ones. Pass the returned `onScroll` to the scrolling container.
 */
export function useChatAutoscroll(containerRef: RefObject<HTMLElement>, trigger: unknown) {
  const stickToBottom = useRef(true)

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }, [containerRef])

  useIsomorphicLayoutEffect(() => {
    const el = containerRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [trigger, containerRef])

  const scrollToBottom = useCallback(() => {
    stickToBottom.current = true
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [containerRef])

  return { onScroll, scrollToBottom }
}
