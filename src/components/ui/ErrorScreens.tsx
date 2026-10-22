import { useEffect, useState } from 'react'

import { Crest, FlapButton, FlapLabel } from '@/design'
import { fitFlapSize } from '@/design/flap'
import { pageSavedLines, savedSetLines, pendingSetCount, type SavedLine, type WorkoutExerciseIn } from '@/features/blockZero/savedSets'
import { apiFetch } from '@/lib/api'
import { loadOutbox, pendingFor, type OutboxEntry } from '@/lib/outbox'

// Errors say what's safe (page 38, approved): what broke, what's saved, one
// way forward. The detail goes to Logs (ErrorBoundary logs it).

function outboxNow(): OutboxEntry[] {
  try {
    return loadOutbox(window.localStorage)
  } catch {
    return loadOutbox(null)
  }
}

function ErrorFrame({ title, line, saved, children }: { title: string; line: string; saved: { head: string; lines: SavedLine[] }; children: React.ReactNode }) {
  return (
    <div className="wm-dark" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'calc(env(safe-area-inset-top) + 16px) 18px calc(env(safe-area-inset-bottom) + 16px)' }}>
      <div role="alert" style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
        <Crest big width={96} dim still />
        {/* Never truncated: steps down a size when the page name is long. */}
        <FlapLabel text={title} size={fitFlapSize(title, 354, 'md')} tone="gold" />
        <p className="wm-prose" style={{ fontWeight: 600 }}>{line}</p>
        <div className="wm-saved">
          <div className="wm-saved-head">{saved.head}</div>
          {saved.lines.map(l => (
            <div key={l.name} className="wm-saved-line">
              <span>{l.name}</span>
              <span>{l.detail}</span>
            </div>
          ))}
        </div>
        <div style={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
      </div>
    </div>
  )
}

/** "Session interrupted": the sets saved (on the server or still on this phone), then RESUME / BACK TO TODAY. */
export function SessionInterruptedScreen({ sessionId, onResume, onBack, onEnd, preview }: { sessionId: string | null; onResume: () => void; /** Keeps the session in progress (page 61). */ onBack: () => void; /** END AND LOG IT: to the close. */ onEnd?: () => void; /** Design gallery only: fixed lines. */ preview?: SavedLine[] }) {
  const [lines, setLines] = useState<SavedLine[] | null>(preview ?? null)
  const pending = sessionId ? pendingFor(outboxNow(), sessionId) : []

  useEffect(() => {
    if (!sessionId || preview) return
    let alive = true
    apiFetch<{ exercises?: WorkoutExerciseIn[] }>(`/api/sessions/${sessionId}/workout`)
      .then(w => { if (alive) setLines(savedSetLines(w.exercises ?? [], pendingFor(outboxNow(), sessionId))) })
      .catch(() => { if (alive) setLines([]) })
    return () => { alive = false }
  }, [sessionId, preview])

  const waiting = pendingSetCount(pending)
  const shown: SavedLine[] = lines && lines.length > 0
    ? lines
    : waiting > 0
      ? [{ name: 'Sets', detail: `${waiting} on this phone` }]
      : [{ name: lines == null ? 'Checking' : 'Sets', detail: lines == null ? '…' : 'none logged yet' }]
  return (
    <ErrorFrame
      title="SESSION INTERRUPTED"
      line="Something broke mid-workout. Everything you logged is safe."
      saved={{ head: waiting > 0 ? 'SAVED ON THE PHONE' : 'SAVED', lines: shown }}
    >
      <FlapButton label="RESUME" primary onClick={onResume} />
      <FlapButton label="BACK TO TODAY" onClick={onBack} />
      {onEnd && <FlapButton label="END AND LOG IT" onClick={onEnd} />}
    </ErrorFrame>
  )
}

/**
 * Page 61, 3E: after iOS closed Waymark (or the phone restarted, or a
 * reload) the session comes back paused where it was. What is saved on the
 * phone, then RESUME, or END AND LOG IT. Nothing is ever abandoned here.
 */
export function BackInSessionScreen({ line, lines, onResume, onEnd }: { line: string; lines: SavedLine[]; onResume: () => void; onEnd: () => void }) {
  return (
    <ErrorFrame title="BACK IN YOUR SESSION" line={line} saved={{ head: 'SAVED ON THE PHONE', lines }}>
      <FlapButton label="RESUME" primary onClick={onResume} />
      <FlapButton label="END AND LOG IT" onClick={onEnd} />
    </ErrorFrame>
  )
}

const PAGE_NAMES: Record<string, string> = {
  '/': 'WAYMARK',
  '/today': 'TODAY',
  '/program': 'THE PROGRAM',
  '/library': 'THE LIBRARY',
  '/history': 'THE LEDGER',
  '/settings': 'SETTINGS',
  '/settings/logs': 'THE LOGS',
  '/metrics': 'BODY METRICS',
}

function pageNameFor(pathname: string): string {
  return PAGE_NAMES[pathname] ?? 'THIS PAGE'
}

/** The page error: names the page, says nothing is lost, RELOAD. */
export function PageErrorScreen({ pathname, onReload, onBack }: { pathname: string; onReload: () => void; onBack?: () => void }) {
  const name = pageNameFor(pathname)
  return (
    <ErrorFrame
      title={`${name} DIDN'T LOAD`}
      line="Your training is safe. This page hit a problem showing it."
      saved={{ head: 'NOTHING LOST', lines: pageSavedLines(outboxNow()) }}
    >
      <FlapButton label="RELOAD" primary onClick={onReload} />
      {onBack && <FlapButton label="BACK TO TODAY" onClick={onBack} />}
    </ErrorFrame>
  )
}
