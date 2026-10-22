import { useEffect, useRef, useState } from 'react'

import { BOARD_OUT_MS } from '@/lib/timers/timerLook'

/** A board leaving on a tap outside (page 74): it fades away over 180 ms, then `then` runs. */
export function useEaseAway(): [boolean, (then: () => void) => void] {
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current) }, [])
  const away = (then: () => void) => {
    if (timer.current != null) return
    setLeaving(true)
    timer.current = window.setTimeout(() => { timer.current = null; setLeaving(false); then() }, BOARD_OUT_MS)
  }
  return [leaving, away]
}

/** "BAG WORK" → "Bag work" for the close window's head. */
export function sentenceCase(text: string): string {
  const t = text.trim().toLowerCase()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

