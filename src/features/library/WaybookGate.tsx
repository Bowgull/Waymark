import { useEffect, useState, type ReactNode } from 'react'

import { LockIcon } from '@/components/icons/SessionIcons'
import { Button } from '@/components/ui/button'
import {
  isGateEnabled,
  isUnlocked,
  requireUnlock,
  subscribe,
} from '@/lib/waybookGate'

interface WaybookGateProps {
  children: ReactNode
  /** What's being unlocked, shown in the Face ID prompt. */
  reason?: string
  /** Optional label for the locked placeholder. */
  label?: string
  /** Render-prop form: children get `unlocked` and can hide auto-loaded content. */
  renderLocked?: () => ReactNode
}

/**
 * Gates children behind Face ID / passcode when the Waybook toggle is on.
 * Unlock only fires when the user taps "Unlock Waybook".
 */
export function WaybookGate({
  children,
  reason = 'Unlock Waybook',
  label = 'Unlock Waybook',
  renderLocked,
}: WaybookGateProps) {
  const [enabled, setEnabled] = useState(isGateEnabled())
  const [unlocked, setUnlocked] = useState(() => isUnlocked())
  const [prompting, setPrompting] = useState(false)

  useEffect(() => {
    const off = subscribe((u) => {
      setUnlocked(u)
      setEnabled(isGateEnabled())
    })
    return off
  }, [])

  if (!enabled || unlocked) return <>{children}</>

  async function handleUnlock() {
    if (prompting) return
    setPrompting(true)
    try {
      const ok = await requireUnlock(reason)
      if (ok) setUnlocked(true)
    } finally {
      setPrompting(false)
    }
  }

  if (renderLocked) return <>{renderLocked()}</>

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-gold/10 bg-near-black/50 px-4 py-6 text-center">
      <LockIcon size={22} />
      <p className="text-sm text-muted-foreground">
        Waybook is locked.
      </p>
      <Button onClick={handleUnlock} disabled={prompting} className="min-w-[180px]">
        {prompting ? 'Unlocking...' : label}
      </Button>
    </div>
  )
}
