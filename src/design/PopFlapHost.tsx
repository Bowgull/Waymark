import { useEffect, useRef, useState } from 'react'

import { FlapLabel } from './FlapLabel'
import { dismissPop, subscribePops, type PopMessage } from './popFlap'

/** A flick up this far clears a pop-up (page 61 rule 6). */
const FLICK_PX = 24

/** Draws the pop-up flap boards. Mount once at the app root. Tap one, or flick it up, to clear it. */
export function PopFlapHost() {
  const [items, setItems] = useState<PopMessage[]>([])
  const start = useRef<{ id: number; y: number } | null>(null)
  useEffect(() => subscribePops(setItems), [])
  if (items.length === 0) return null
  return (
    <div className="wm-pop-host" aria-live="polite" role="status" data-no-cascade>
      {items.map(m => (
        <div
          key={m.id}
          className={`wm-pop is-${m.tone}${m.leaving ? ' is-leaving' : ''}`}
          onClick={() => dismissPop(m.id)}
          onPointerDown={e => { start.current = { id: m.id, y: e.clientY } }}
          onPointerUp={e => {
            const s = start.current
            start.current = null
            if (s && s.id === m.id && s.y - e.clientY >= FLICK_PX) dismissPop(m.id)
          }}
          style={{ touchAction: 'none' }}
        >
          {/* page 35 A: good news on a teal flap; a failure's words on plain tiles, the clay is the board's edge */}
          {m.title && <FlapLabel text={m.title} size="sm" tone={m.tone === 'good' ? 'teal' : 'ink'} animate="mount" />}
          {m.text && <p className="wm-pop-text">{m.text}</p>}
          {m.actionLabel && m.onAction && (
            <button
              type="button"
              className="wm-chip"
              onClick={e => {
                e.stopPropagation()
                m.onAction?.()
                dismissPop(m.id)
              }}
            >
              <FlapLabel text={m.actionLabel} size="xs" tone="gold" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
