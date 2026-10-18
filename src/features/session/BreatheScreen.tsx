import { useEffect } from 'react'

import { FlapLabel } from '@/design'
import { setWorldBackdrop } from '@/world/worldStore'

import './session.css'

/**
 * Breathe (page 31, approved): three seconds between Foundation exercises over
 * the forest. A breathing ring, BREATHE on a teal flap, "Next exercise coming...".
 * No buttons.
 */
export function BreatheScreen() {
  useEffect(() => {
    setWorldBackdrop('clearing')
    return () => setWorldBackdrop(null)
  }, [])
  return (
    <div className="tm-screen is-forest" role="status" aria-label="Breathe. Next exercise coming.">
      <div className="tm-forest-scrim" aria-hidden />
      <div className="ss-breathe">
        <div className="ss-ring" aria-hidden />
        <FlapLabel text="BREATHE" size="lg" tone="teal" animate="mount" />
        <p className="wm-prose is-dim" style={{ margin: 0 }}>Next exercise coming...</p>
      </div>
    </div>
  )
}
