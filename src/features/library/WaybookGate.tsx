import { useState, type ReactNode } from 'react'

import { CentredCard, FlapButton } from '@/design'
import { requireUnlock } from '@/lib/waybookGate'

import { useWaybookUnlocked } from './useWaybookUnlocked'
import './library.css'

/**
 * Page 21 "Locked": a centred card over the veil, the key, "Waybook is
 * locked." and UNLOCK WAYBOOK on brass. Face ID runs only when the button is
 * tapped. Tapping the veil (outside the card) calls `onDismiss`.
 */
export function WaybookLockedCard({ reason = 'Unlock Waybook', onUnlocked, onDismiss }: { reason?: string; onUnlocked?: () => void; onDismiss?: () => void }) {
  const [prompting, setPrompting] = useState(false)

  async function handleUnlock() {
    if (prompting) return
    setPrompting(true)
    try {
      const ok = await requireUnlock(reason)
      if (ok) onUnlocked?.()
    } finally {
      setPrompting(false)
    }
  }

  return (
    <CentredCard label="Waybook is locked" onDismiss={onDismiss} className="lib-locked">
      <span className="lib-locked-key" aria-hidden>⚿</span>
      <p className="wm-prose">Waybook is locked.</p>
      <FlapButton label="UNLOCK WAYBOOK" size="sm" primary onClick={handleUnlock} disabled={prompting} />
    </CentredCard>
  )
}

interface WaybookGateProps {
  children: ReactNode
  /** What's being unlocked, shown in the Face ID prompt. */
  reason?: string
  /** Tapping outside the locked card. */
  onDismiss?: () => void
  /** Render-prop form: what to show while locked instead of the card. */
  renderLocked?: () => ReactNode
}

/**
 * Gates children behind Face ID / passcode when the Waybook toggle is on.
 * Unlock only fires when the user taps "Unlock Waybook".
 */
export function WaybookGate({ children, reason = 'Unlock Waybook', onDismiss, renderLocked }: WaybookGateProps) {
  const unlocked = useWaybookUnlocked()
  if (unlocked) return <>{children}</>
  if (renderLocked) return <>{renderLocked()}</>
  return <WaybookLockedCard reason={reason} onDismiss={onDismiss} />
}
