import { useEffect, useState } from 'react'

import { isGateEnabled, isUnlocked, subscribe } from '@/lib/waybookGate'

/** Is the Waybook readable now? Follows the gate (the Face ID toggle, the 3-minute relock). */
export function useWaybookUnlocked(): boolean {
  const [state, setState] = useState(() => !isGateEnabled() || isUnlocked())
  useEffect(() => subscribe(u => setState(!isGateEnabled() || u)), [])
  return state
}
