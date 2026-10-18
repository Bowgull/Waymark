import { useCallback, useEffect, useReducer, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Board, CentredCard, FlapButton, FlapChip, FlapDrum, FlapLabel, TileChoice, showPop } from '@/design'
import { apiFetch, idempotencyHeaders } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'

import {
  existingValues,
  guidedReducer,
  initialGuided,
  sheetRows,
  testsForWeek,
  testsPayload,
  weekTestTitle,
  formatTestValue,
  type GuidedState,
  type TestRowIn,
  type TestSpecUI,
} from './testWeek'

interface BlockIn {
  id: string
  blockType: string
  totalWeeks: number
  currentWeek?: number
}

const SCORE_TILES = [1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v), sub: v === 1 ? 'locked' : v === 5 ? 'free' : undefined }))

/** One test's big entry: a ▲▼ number, or five tiles for a 1-5 score. */
export function TestEntryControl({ spec, value, onChange }: { spec: TestSpecUI; value: number; onChange: (v: number) => void }) {
  if (spec.entry === 'score') {
    return <TileChoice label={spec.label} columns={5} options={SCORE_TILES} selected={value} onPick={onChange} />
  }
  return <FlapDrum label={spec.label} value={value} onChange={onChange} step={spec.step} min={spec.min} max={spec.max} unit={spec.unit === 'reps' ? 'reps' : spec.unit} />
}

// ─── Guided steps (view) ──────────────────────────────────────

export function GuidedTestView({
  week,
  tests,
  state,
  saving,
  onDial,
  onNext,
  onSkip,
  onBack,
  onExit,
  onOpenSheet,
}: {
  week: number
  tests: readonly TestSpecUI[]
  state: GuidedState
  saving: boolean
  onDial: (v: number) => void
  onNext: () => void
  onSkip: () => void
  onBack: () => void
  onExit: () => void
  onOpenSheet: () => void
}) {
  const spec = tests[state.index]
  const savedKeys = Object.keys(state.saved)
  return (
    <div className="wm-dark" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 16px)', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <FlapChip label="‹ BACK" onClick={state.index > 0 && !state.done ? onBack : onExit} />
        <span className="wm-board-head" style={{ margin: 0 }}>{week === 1 ? 'Test week' : 'Retest'}</span>
        <span className="wm-num">{Math.min(state.index + 1, tests.length)}/{tests.length}</span>
      </div>
      <div className="wm-dots" aria-hidden>
        {tests.map((t, i) => (
          <i key={t.key} className={state.saved[t.key] != null ? 'is-done' : i === state.index && !state.done ? 'is-now' : ''} />
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {!state.done && spec ? (
        <>
          <Board head={week === 1 ? 'Test' : 'Retest'}>
            <FlapLabel text={spec.label} size="md" animate="mount" key={spec.key} />
            <p className="wm-prose" style={{ marginTop: 10 }}>{spec.how}</p>
          </Board>
          <Board>
            <TestEntryControl spec={spec} value={state.dial[spec.key]} onChange={onDial} />
          </Board>
          <FlapButton label={saving ? 'SAVING' : 'SAVE · NEXT'} primary onClick={onNext} disabled={saving} />
          <FlapButton label="NOT TODAY" quiet onClick={onSkip} disabled={saving} />
        </>
      ) : (
        <>
          <Board edge="good" head={weekTestTitle(week)} headRight={<span className="wm-num">{savedKeys.length} saved</span>}>
            <FlapLabel text={savedKeys.length > 0 ? 'BASELINE IN' : 'NOTHING SAVED'} size="md" tone={savedKeys.length > 0 ? 'teal' : 'ink'} animate="mount" />
            <div className="wm-rows" style={{ marginTop: 8 }}>
              {tests.filter(t => state.saved[t.key] != null).map(t => (
                <div key={t.key} className="wm-row">
                  <span className="wm-prose" style={{ flex: 1 }}>{t.label}</span>
                  <span className="wm-num">{formatTestValue(state.saved[t.key], t.unit)}</span>
                </div>
              ))}
            </div>
            {savedKeys.length < tests.length && (
              <p className="wm-prose is-dim" style={{ marginTop: 8 }}>The rest can go in later, from the results.</p>
            )}
          </Board>
          <FlapButton label="RESULTS" onClick={onOpenSheet} />
          <FlapButton label="DONE" primary onClick={onExit} />
        </>
      )}
    </div>
  )
}

// ─── Results sheet (view) ─────────────────────────────────────

export function ResultsSheetCard({
  week,
  totalWeeks,
  rows,
  onEnter,
  onClose,
}: {
  week: number
  totalWeeks: number
  rows: readonly TestRowIn[]
  onEnter: (spec: TestSpecUI) => void
  onClose: () => void
}) {
  const list = sheetRows(week, totalWeeks, rows)
  const specs = new Map(testsForWeek(week, totalWeeks).map(t => [t.key, t]))
  const filled = list.filter(r => r.value != null).length
  return (
    <CentredCard label="Test results" head={weekTestTitle(week)} headRight={<span className="wm-num" style={{ color: '#8fd4b8' }}>{filled} / {list.length}</span>} onDismiss={onClose}>
      {list.length === 0 ? (
        <p className="wm-prose">Week {week}&apos;s check is the strength check set. It&apos;s logged from the effort tap after each set.</p>
      ) : (
        <div className="wm-rows">
          {list.map(r => {
            const spec = specs.get(r.key)
            return (
              <button
                key={r.key}
                type="button"
                className="wm-row"
                disabled={!r.editable || !spec}
                onClick={() => spec && onEnter(spec)}
                style={{ width: '100%', minHeight: 48, background: 'none', border: 0, textAlign: 'left', cursor: r.editable ? 'pointer' : 'default' }}
              >
                <span aria-hidden style={{ width: 18, fontFamily: 'var(--font-mono)', fontWeight: 800, color: r.value != null ? '#8fd4b8' : 'rgba(240,230,192,.35)' }}>{r.value != null ? '◆' : '··'}</span>
                <span className="wm-prose" style={{ flex: 1 }}>{r.label}</span>
                {r.value != null ? <span className="wm-num">{r.value}</span> : <span className="wm-label" style={{ color: '#e8c878' }}>enter ›</span>}
              </button>
            )
          })}
        </div>
      )}
      <FlapButton label="DONE FOR NOW" onClick={onClose} />
    </CentredCard>
  )
}

/** One result, entered or fixed from the sheet. */
export function TestEntryCard({ spec, start, saving, onSave, onClose }: { spec: TestSpecUI; start: number; saving: boolean; onSave: (v: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(start)
  return (
    <CentredCard label={spec.label} head={`Test · ${spec.label}`} sub={spec.how} onDismiss={saving ? undefined : onClose}>
      <TestEntryControl spec={spec} value={value} onChange={setValue} />
      <div className="wm-btns">
        <FlapButton label="CANCEL" onClick={onClose} disabled={saving} />
        <FlapButton label={saving ? 'SAVING' : 'SAVE'} primary onClick={() => onSave(value)} disabled={saving} />
      </div>
    </CentredCard>
  )
}

// ─── Data ─────────────────────────────────────────────────────

/** The active Block Zero block and its results; saves one result at a time. */
function useBlockTests(weekParam: number | null) {
  const [block, setBlock] = useState<BlockIn | null | undefined>(undefined)
  const [rows, setRows] = useState<TestRowIn[]>([])
  const week = weekParam ?? block?.currentWeek ?? 1

  const reload = useCallback(async (b: BlockIn) => {
    const r = await apiFetch<TestRowIn[]>(`/api/blocks/${b.id}/tests`)
    setRows(r)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const b = await apiFetch<BlockIn | null>(`/api/blocks/current?date=${getTodayISO()}`)
        if (!alive) return
        setBlock(b && b.blockType === 'block_zero' ? b : null)
        if (b && b.blockType === 'block_zero') await reload(b)
      } catch {
        if (alive) setBlock(null)
      }
    })()
    return () => { alive = false }
  }, [reload])

  const save = useCallback(async (results: ReturnType<typeof testsPayload>): Promise<boolean> => {
    if (!block || results.length === 0) return true
    try {
      await apiFetch(`/api/blocks/${block.id}/tests`, { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify(results) })
      await reload(block).catch(() => {})
      return true
    } catch (e) {
      let reason: string | null = null
      try { reason = (JSON.parse((e as { body?: string }).body ?? '') as { error?: string }).error ?? null } catch { reason = null }
      showPop(reason ?? "Couldn't save. Check your connection.", 'bad', { title: "COULDN'T SAVE", durationMs: 4000 })
      return false
    }
  }, [block, reload])

  return { block, rows, week, save }
}

// ─── The page (guided steps + the sheet) ──────────────────────

/** /block-zero/tests?week=N: guided, one test per step; RESULTS opens the sheet. */
export function TestWeekPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const weekParam = params.get('week') != null ? Number(params.get('week')) : null
  const openSheetFirst = params.get('sheet') === '1'
  const { block, rows, week, save } = useBlockTests(Number.isInteger(weekParam) ? weekParam : null)
  const tests = block ? testsForWeek(week, block.totalWeeks) : []

  if (block === undefined) {
    return <div className="wm-dark" style={{ minHeight: '100dvh' }} />
  }
  if (block === null) {
    return (
      <div className="wm-dark" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
        <Board head="Test week">
          <p className="wm-prose">Tests belong to Block Zero. There&apos;s no Block Zero running.</p>
          <div style={{ marginTop: 12 }}><FlapButton label="BACK TO PROGRAM" onClick={() => navigate('/program')} /></div>
        </Board>
      </div>
    )
  }
  return <TestWeekFlow key={`${block.id}-${week}`} week={week} totalWeeks={block.totalWeeks} tests={tests} rows={rows} save={save} openSheetFirst={openSheetFirst} onExit={() => navigate('/program')} />
}

function TestWeekFlow({
  week,
  totalWeeks,
  tests,
  rows,
  save,
  openSheetFirst,
  onExit,
}: {
  week: number
  totalWeeks: number
  tests: readonly TestSpecUI[]
  rows: TestRowIn[]
  save: (results: ReturnType<typeof testsPayload>) => Promise<boolean>
  openSheetFirst: boolean
  onExit: () => void
}) {
  const [state, dispatch] = useReducer(
    (s: GuidedState, a: Parameters<typeof guidedReducer>[2]) => guidedReducer(tests, s, a),
    undefined,
    () => initialGuided(tests, existingValues(week, rows)),
  )
  const [saving, setSaving] = useState(false)
  const [sheet, setSheet] = useState(openSheetFirst || tests.length === 0)
  const [editing, setEditing] = useState<TestSpecUI | null>(null)

  async function next() {
    const spec = tests[state.index]
    if (!spec) return
    setSaving(true)
    // Saved as you go: a closed app keeps every step already done.
    const ok = await save(testsPayload(week, { [spec.key]: state.dial[spec.key] }, tests))
    setSaving(false)
    if (ok) dispatch({ type: 'next' })
  }

  const existing = existingValues(week, rows)
  return (
    <>
      <GuidedTestView
        week={week}
        tests={tests}
        state={state}
        saving={saving}
        onDial={v => dispatch({ type: 'dial', value: v })}
        onNext={() => void next()}
        onSkip={() => dispatch({ type: 'skip' })}
        onBack={() => dispatch({ type: 'back' })}
        onExit={onExit}
        onOpenSheet={() => setSheet(true)}
      />
      {sheet && !editing && (
        <ResultsSheetCard week={week} totalWeeks={totalWeeks} rows={rows} onEnter={setEditing} onClose={() => { setSheet(false); if (tests.length === 0) onExit() }} />
      )}
      {editing && (
        <TestEntryCard
          spec={editing}
          start={existing[editing.key] ?? editing.start}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={async v => {
            setSaving(true)
            const ok = await save(testsPayload(week, { [editing.key]: v }, tests))
            setSaving(false)
            if (ok) {
              showPop('Saved.', 'good')
              setEditing(null)
            }
          }}
        />
      )}
    </>
  )
}
