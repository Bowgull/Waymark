import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Board, Crest, FlapButton, FlapLabel, showPop, useReducedMotion } from '@/design'
import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'

import { retestComparison, verdictFor, type ComparisonRow, type TransitionResultIn } from './gate'
import type { TestRowIn } from './testWeek'

const CHECK_TIMEOUT_MS = 170_000

function ComparisonBoard({ rows }: { rows: ComparisonRow[] }) {
  return (
    <Board head="Week 1 → retest">
      {rows.length === 0 ? (
        <p className="wm-prose is-dim">No retest numbers yet. The week-6 tests and check sets fill this in.</p>
      ) : (
        <div className="wm-rows">
          {rows.map(r => (
            <div
              key={r.key}
              className="wm-row"
              style={r.better == null ? undefined : { boxShadow: `inset 3px 0 0 ${r.better ? '#5fa08c' : '#c4623f'}`, paddingLeft: 8, background: r.better ? 'rgba(95,160,140,.10)' : 'rgba(196,98,64,.10)' }}
            >
              <span className="wm-prose" style={{ flex: 1, fontSize: 15 }}>{r.label}</span>
              <span className="wm-num" style={{ whiteSpace: 'nowrap' }}>{r.before} → {r.after}</span>
              <span className="wm-num" style={{ minWidth: 46, textAlign: 'right', color: r.better == null ? undefined : r.better ? '#8fd4b8' : '#f0a684' }}>{r.delta}</span>
            </div>
          ))}
        </div>
      )}
    </Board>
  )
}

/** The full-screen end gate (view): the crest, week 1 against the retest, the verdict, one way forward. */
export function EndGateView({
  rows,
  result,
  checking,
  onCheck,
  onPrimary,
  onBack,
}: {
  rows: readonly TestRowIn[]
  result: TransitionResultIn | null
  checking: boolean
  onCheck: () => void
  onPrimary: () => void
  onBack: () => void
}) {
  const reduced = useReducedMotion()
  const comparison = retestComparison(rows)
  const verdict = result ? verdictFor(result) : null
  const enter = (delayMs: number) => (reduced ? undefined : { animation: `wm-settle 700ms var(--ease-out) ${delayMs}ms both` })
  return (
    <div className="wm-dark" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 12, padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 16px)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <span className="wm-board-head" style={{ margin: 0 }}>Block Zero · retest</span>
        <div style={reduced ? undefined : { animation: 'wm-card-in 900ms var(--ease-out) both' }}>
          <Crest big width={checking ? 120 : 150} still={!checking && reduced} />
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={enter(300)}>
        <ComparisonBoard rows={comparison} />
      </div>
      {verdict ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...(enter(600) ?? {}) }}>
          <Board edge={verdict.tone === 'good' ? 'good' : verdict.tone === 'bad' ? 'bad' : 'brass'} head="The verdict">
            <FlapLabel text={verdict.title} size="md" tone={verdict.tone === 'good' ? 'teal' : 'gold'} animate="mount" />
            {verdict.line && <p className="wm-prose" style={{ marginTop: 10 }}>{verdict.line}</p>}
            {verdict.reasons.length > 0 && (
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {verdict.reasons.map(r => (
                  <li key={r} className="wm-prose is-dim" style={{ display: 'flex', gap: 8 }}>
                    <span aria-hidden style={{ color: '#c9a656' }}>◆</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </Board>
          <FlapButton label={verdict.primaryLabel} primary onClick={onPrimary} />
          {/* Moving on has already started the next block: no second check. */}
          {verdict.kind !== 'move_on' && <FlapButton label="CHECK AGAIN" quiet onClick={onCheck} disabled={checking} />}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...(enter(600) ?? {}) }}>
          <Board head="The verdict">
            <p className="wm-prose">{checking ? 'Reading your block.' : 'The rules read consistency, your back and the retest, then the coach adds a second opinion. Move on or extend 1–2 weeks.'}</p>
          </Board>
          <FlapButton label={checking ? 'READING' : 'CHECK READINESS'} primary onClick={onCheck} disabled={checking} />
          <FlapButton label="BACK TO PROGRAM" quiet onClick={onBack} disabled={checking} />
        </div>
      )}
    </div>
  )
}

/** /block-zero/gate: loads the stored verdict and the results; CHECK READINESS runs the gate. */
export function EndGatePage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<TestRowIn[]>([])
  const [result, setResult] = useState<TransitionResultIn | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [block, stored] = await Promise.all([
          apiFetch<{ id: string; blockType: string } | null>(`/api/blocks/current?date=${getTodayISO()}`),
          apiFetch<TransitionResultIn | null>('/api/ai/block-zero-transition').catch(() => null),
        ])
        if (!alive) return
        if (stored) setResult(stored)
        if (block?.blockType === 'block_zero') {
          const r = await apiFetch<TestRowIn[]>(`/api/blocks/${block.id}/tests`)
          if (alive) setRows(r)
        }
      } catch {
        // offline: the page still shows what it can
      }
    })()
    return () => { alive = false }
  }, [])

  async function check() {
    setChecking(true)
    try {
      // The rules decide (and apply: extend lengthens the block, move on starts Fighter Block 1).
      const r = await apiFetch<TransitionResultIn>('/api/ai/block-zero-transition', { method: 'POST', timeoutMs: CHECK_TIMEOUT_MS })
      setResult(r)
    } catch {
      showPop("Couldn't read the block. Check your connection.", 'bad', { title: "COULDN'T CHECK", durationMs: 4000 })
    } finally {
      setChecking(false)
    }
  }

  return (
    <EndGateView
      rows={rows}
      result={result}
      checking={checking}
      onCheck={() => void check()}
      onPrimary={() => navigate('/program')}
      onBack={() => navigate('/program')}
    />
  )
}
