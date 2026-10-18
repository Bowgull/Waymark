import { useEffect, useState } from 'react'

import { FlapLabel } from './FlapLabel'
import { dismissPop, subscribePops, type PopMessage } from './popFlap'

/** Draws the pop-up flap boards. Mount once at the app root. */
export function PopFlapHost() {
  const [items, setItems] = useState<PopMessage[]>([])
  useEffect(() => subscribePops(setItems), [])
  if (items.length === 0) return null
  return (
    <div className="wm-pop-host" aria-live="polite" role="status">
      {items.map(m => (
        <div key={m.id} className={`wm-pop is-${m.tone}${m.leaving ? ' is-leaving' : ''}`} onClick={() => dismissPop(m.id)}>
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
