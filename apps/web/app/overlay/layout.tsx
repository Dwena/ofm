import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Widget OBS',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

/**
 * OBS browser sources: transparent page, no scrollbars, no app chrome. The
 * root layout's background (body bg-background) and the theme's
 * color-scheme are overridden here; the AuthProvider skips /overlay/* (no
 * session, never touches the creator's tokens).
 */
const OVERLAY_CSS = `
html, body {
  background: transparent !important;
  background-color: transparent !important;
  color-scheme: normal !important;
  overflow: hidden !important;
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}
body::-webkit-scrollbar { display: none; }

@keyframes ov-slide-in { from { transform: translateY(-120%); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes ov-slide-out { from { transform: none; opacity: 1 } to { transform: translateY(-120%); opacity: 0 } }
@keyframes ov-pop-in {
  0% { transform: scale(0.3); opacity: 0 }
  60% { transform: scale(1.08); opacity: 1 }
  80% { transform: scale(0.97) }
  100% { transform: scale(1) }
}
@keyframes ov-pop-out { from { transform: scale(1); opacity: 1 } to { transform: scale(0.6); opacity: 0 } }
@keyframes ov-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes ov-fade-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes ov-glow { 0%, 100% { filter: drop-shadow(0 0 0 transparent) } 50% { filter: drop-shadow(0 0 18px var(--ov-accent)) } }
@keyframes ov-line-in { from { transform: translateX(-16px); opacity: 0 } to { transform: none; opacity: 1 } }

.ov-slide-in { animation: ov-slide-in 450ms cubic-bezier(.2,.9,.3,1.2) both }
.ov-slide-out { animation: ov-slide-out 350ms ease-in both }
.ov-pop-in { animation: ov-pop-in 550ms ease-out both }
.ov-pop-out { animation: ov-pop-out 300ms ease-in both }
.ov-fade-in { animation: ov-fade-in 500ms ease-out both }
.ov-fade-out { animation: ov-fade-out 400ms ease-in both }
.ov-glow { animation: ov-glow 1.6s ease-in-out infinite }
.ov-line-in { animation: ov-line-in 300ms ease-out both }
.ov-fill { transition: width 900ms cubic-bezier(.2,.8,.2,1) }
.ov-hidden { opacity: 0; transition: opacity 600ms ease }

.ov-checkerboard {
  background-color: #ffffff;
  background-image:
    linear-gradient(45deg, #d4d4d8 25%, transparent 25%),
    linear-gradient(-45deg, #d4d4d8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #d4d4d8 75%),
    linear-gradient(-45deg, transparent 75%, #d4d4d8 75%);
  background-size: 24px 24px;
  background-position: 0 0, 0 12px, 12px -12px, -12px 0;
}

@media (prefers-reduced-motion: reduce) {
  .ov-slide-in, .ov-pop-in, .ov-fade-in, .ov-line-in { animation: ov-fade-in 200ms linear both }
  .ov-slide-out, .ov-pop-out, .ov-fade-out { animation: ov-fade-out 200ms linear both }
  .ov-glow { animation: none }
  .ov-fill { transition: none }
}
`

export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: OVERLAY_CSS }} />
      {children}
    </>
  )
}
