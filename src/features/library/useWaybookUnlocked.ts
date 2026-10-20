import { useEffect, useState } from 'react'

import { isUnlocked, subscribe } from '@/lib/waybookGate'

/** Is the Waybook readable now without asking? Follows the gate (the switch, the 3-minute window, leaving the app). */
export function useWaybookUnlocked(): boolean {
  const [state, setState] = useState(() => isUnlocked())
  useEffect(() => subscribe(u => setState(u)), [])
  return state
}
