// Pull a centred board down to close it (page 61 rule 2).

import { useRef, useState, type PointerEvent } from 'react'

/** Pulled this far down and let go, a board closes (page 61 rule 2); less and it settles back. */
export const PULL_CLOSE_PX = 70

/**
 * Drag a board down by its head or its brass grabber: past PULL_CLOSE_PX and
 * let go, it closes; earlier, it settles back. Returns the pointer handlers
 * for the handle and the current offset.
 */
export function usePullDown(onClose: (() => void) | undefined) {
  const [dy, setDy] = useState(0)
  const start = useRef<{ y: number; id: number } | null>(null)
  if (!onClose) return { dy: 0, handlers: {} }
  return {
    dy,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return
        start.current = { y: e.clientY, id: e.pointerId }
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (!start.current || start.current.id !== e.pointerId) return
        setDy(Math.max(0, e.clientY - start.current.y))
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        if (!start.current) return
        const pulled = Math.max(0, e.clientY - start.current.y)
        start.current = null
        setDy(0)
        if (pulled >= PULL_CLOSE_PX) onClose()
      },
      onPointerCancel: () => { start.current = null; setDy(0) },
    },
  }
}

