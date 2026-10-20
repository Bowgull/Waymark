import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { FlapLabel, SessionIcon, type SessionIconKey } from '@/design'
import { liveLine, readLiveSession, type LiveSession } from '@/lib/liveSession'
import { loadResume } from '@/lib/sessionResume'

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

/** The open session, read again every second (it ticks in true time). */
function useLiveSession(): { live: LiveSession; line: string; clock: string; fill: number } | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = storage()
  const live = readLiveSession(s)
  if (!live) return null
  const saved = loadResume(s, live.sessionId)
  if (!saved) return null
  return { live, ...liveLine(live, saved, now) }
}

/**
 * The live strip (page 61, 3B, choice A): above the tabs on every tab while a
 * session is open. Its icon, name, round and phase, a pulsing brass dot, the
 * running clock and a thin progress line. One tap goes back in, exactly where
 * it is.
 */
export function LiveStrip() {
  const navigate = useNavigate()
  const v = useLiveSession()
  if (!v) return null
  return (
    <button type="button" className="wm-live" onClick={() => navigate(`/session/${v.live.sessionId}`)} aria-label={`${v.live.name}, ${v.line}, ${v.clock}. Back into the session.`}>
      <SessionIcon kind={v.live.icon as SessionIconKey} size={36} label="" />
      <span className="tx">
        <FlapLabel text={v.live.name} size="sm" animate={false} />
        <span className="sl">{v.line}</span>
      </span>
      <span className="beat" aria-hidden />
      <FlapLabel text={v.clock} size="sm" tone="gold" animate={false} />
      <span className="chev" aria-hidden>›</span>
      <span className="fill" style={{ width: `${Math.round(v.fill * 100)}%` }} aria-hidden />
    </button>
  )
}
