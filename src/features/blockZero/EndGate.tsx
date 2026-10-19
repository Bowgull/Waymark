import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Board, Crest, FlapButton, FlapLabel, showPop, useReducedMotion } from '@/design'
import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'

import { retestComparison, verdictFor, type ComparisonRow, type TransitionResultIn } from './gate'
import type { TestRowIn } from './testWeek'
import './blockZero.css'

const CHECK_TIMEOUT_MS = 170_000

function ComparisonBoard({ rows }: { rows: ComparisonRow[] }) {
  return (
    <Board className="bz-bd" head="Then → now">
      {rows.length === 0 ? (
        <p className="bz-q is-last">No week-6 talk test yet. Log it on an easy run.</p>
      ) : rows.map(r => {
        // Page 45: teal band up, clay band down; no change or no judgement is a plain row with a neutral chip.
        const tone = r.better == null ? 'nt' : r.better ? 'up' : 'dn'
        return (
          <div key={r.key} className={`bz-cmp${tone === 'nt' ? '' : ` is-${tone}`}`}>
            <span className="n">{r.label}<small>{r.source}</small></span>
            <span className="v">{r.span}</span>
            <i className={`bz-dv is-${tone}`}>{r.delta}</i>
          </div>
        )
      })}
    </Board>
  )
}

/**
 * The end gate (page 45): the crest, week 1 against the retest with the teal /
 * clay bands and chips, then THE VERDICT. Before the check: what the check
 * reads, CHECK READINESS / BACK TO PROGRAM. MOVE ON (teal) leads to START
 * FIGHTER BLOCK 1; EXTEND 1 WEEK (gold) to KEEP BUILDING; the reasons are
 * brass-diamond lines.
 */
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
    <div className="bz-gate">
      <div className="bz-title"><FlapLabel text="BLOCK ZERO · THE GATE" size="xs" tone="gold" animate={false} /></div>
      <div style={{ alignSelf: 'center', ...(reduced ? {} : { animation: 'wm-card-in 900ms var(--ease-out) both' }) }}>
        <Crest big width={120} still={!checking && reduced} />
      </div>
      <div style={enter(300)}>
        <ComparisonBoard rows={comparison} />
      </div>
      {verdict ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...(enter(600) ?? {}) }}>
          <Board className={`bz-bd ${verdict.tone === 'good' ? 'is-teal' : 'is-gold'}`} head="The verdict">
            <FlapLabel text={verdict.title} size="md" tone={verdict.tone === 'good' ? 'teal' : 'gold'} animate="mount" />
            {verdict.line && <p className={`bz-q${verdict.reasons.length > 0 ? '' : ' is-last'}`}>{verdict.line}</p>}
            {verdict.reasons.length > 0 && (
              <ul className="bz-why">
                {verdict.reasons.map(r => <li key={r}>{r}</li>)}
              </ul>
            )}
          </Board>
          <FlapButton label={verdict.primaryLabel} primary onClick={onPrimary} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...(enter(600) ?? {}) }}>
          <Board className="bz-bd" head="The verdict">
            <p className="bz-q" style={{ margin: 0 }}>{checking ? 'Reading your block.' : 'The rules read consistency, your back and the retest, then the coach adds a second opinion. Move on or extend 1–2 weeks.'}</p>
          </Board>
          <FlapButton label={checking ? 'READING' : 'CHECK READINESS'} primary onClick={onCheck} disabled={checking} />
          <FlapButton label="BACK TO PROGRAM" size="xs" onClick={onBack} disabled={checking} />
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
