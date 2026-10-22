import { useEffect, useState } from 'react'

import { readLiveSession } from '@/lib/liveSession'
import { loadResume } from '@/lib/sessionResume'

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

/** The session the strip is showing now (the open one, with its saved place), or null. */
export function stripSessionId(): string | null {
  const s = storage()
  const live = readLiveSession(s)
  return live && loadResume(s, live.sessionId) ? live.sessionId : null
}

/**
 * The strip's session id, kept current (read every second, changes only when
 * it does). Page 71: a running session shows once, as the strip; Today's list
 * and Program's day board leave it out or say "under way" without RESUME.
 */
export function useStripSessionId(): string | null {
  // Read fresh on every render (coming back to a kept tab shows it at once); the
  // timer only re-renders when the answer has changed underneath (lock-screen End).
  const id = stripSessionId()
  const [, setSeen] = useState(id)
  useEffect(() => {
    const read = () => setSeen(stripSessionId())
    const t = window.setInterval(read, 1000)
    document.addEventListener('visibilitychange', read)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', read) }
  }, [])
  return id
}
