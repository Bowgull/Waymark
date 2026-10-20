import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Board, FlapLabel, glowRow } from '@/design'
import { apiFetch } from '@/lib/api'
import { DobCard, NumberCard } from './SettingsCards'
import { SBlock, SRow } from './settingsParts'
import { dobFlaps, formatDob, parseDob, tanakaMaxHr, type Ymd } from './settingsModel'

interface Profile {
  dob: string | null
  maxHr: number | null
  injuries: string | null
}

type Patch = Partial<Profile>

function errorText(err: unknown): string {
  try {
    const r = (JSON.parse((err as { body?: string }).body ?? '') as { error?: string }).error
    if (r) return r
  } catch { /* not JSON */ }
  return "Couldn't save. Check your connection."
}

/**
 * Settings A's Body board (page 37) with "For the coach" inside it (page 45,
 * approved): Body metrics ›, then birth date and max heart rate on flaps
 * (tap: the drums card) and the back-and-pain box. Saves as you go, with
 * PATCH /api/user-profile; the touched row answers (glow), a failure keeps
 * its words under the row.
 */
export function BodyProfileBoard() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [injuries, setInjuries] = useState('')
  const [card, setCard] = useState<'dob' | 'maxHr' | null>(null)
  const [error, setError] = useState<{ row: string; text: string } | null>(null)
  const rows = useRef<Record<string, HTMLDivElement | null>>({})
  const savedInjuries = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    apiFetch<Profile | null>('/api/user-profile')
      .then(p => {
        if (!alive) return
        const v = { dob: p?.dob ?? null, maxHr: p?.maxHr ?? null, injuries: p?.injuries ?? null }
        setProfile(v)
        setInjuries(v.injuries ?? '')
        savedInjuries.current = v.injuries ?? ''
      })
      .catch(() => { if (alive) { setProfile({ dob: null, maxHr: null, injuries: null }); savedInjuries.current = '' } })
    return () => { alive = false }
  }, [])

  async function save(row: string, patch: Patch) {
    setError(null)
    try {
      const saved = await apiFetch<Profile>('/api/user-profile', { method: 'PATCH', body: JSON.stringify(patch) })
      setProfile(p => ({ dob: saved?.dob ?? p?.dob ?? null, maxHr: saved?.maxHr !== undefined ? saved.maxHr : p?.maxHr ?? null, injuries: saved?.injuries !== undefined ? saved.injuries : p?.injuries ?? null }))
      glowRow(rows.current[row] ?? null, 'good')
      return true
    } catch (err) {
      setError({ row, text: errorText(err) })
      glowRow(rows.current[row] ?? null, 'bad')
      return false
    }
  }

  // Back and pain: saved as you type (a pause of 0.8 s), and on leave (page 61: a quick leave never loses it).
  const flushInjuries = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (savedInjuries.current == null || injuries === savedInjuries.current) { flushInjuries.current = null; return }
    const run = () => {
      flushInjuries.current = null
      const text = injuries.trim()
      void save('injuries', { injuries: text || null }).then(ok => { if (ok) savedInjuries.current = injuries })
    }
    flushInjuries.current = run
    const t = window.setTimeout(run, 800)
    return () => window.clearTimeout(t)
  }, [injuries])
  useEffect(() => () => { flushInjuries.current?.() }, [])

  const dob = parseDob(profile?.dob)
  const estimate = tanakaMaxHr(dob, new Date())
  const maxHr = profile?.maxHr ?? estimate
  const [dd, mon, yyyy] = dob ? dobFlaps(dob) : ['', '', '']
  const note = (row: string) => error?.row === row ? <p className="wm-row-note" role="alert">{error.text}</p> : null
  const defaultDob: Ymd = { y: new Date().getFullYear() - 30, m: 1, d: 1 }

  return (
    <>
    <Board head="Body" solid className="st-board">
      <SRow label="Body metrics" sub="Weight, resting HR, bodyfat. For trends only." onClick={() => navigate('/metrics')} ariaLabel="Body metrics">
        <span className="st-chev" aria-hidden>›</span>
      </SRow>
      <div ref={el => { rows.current.dob = el }} className="st-rowwrap">
        <SRow label="Birth date" sub="For your heart-rate zones." onClick={() => setCard('dob')} ariaLabel={`Birth date${dob ? `, ${dd} ${mon} ${yyyy}` : ', not set'}. Change`}>
          <span className="st-dob">
            <FlapLabel text={dd} len={dd ? 0 : 2} size="sm" />
            <FlapLabel text={mon} len={mon ? 0 : 3} size="sm" />
            <FlapLabel text={yyyy} len={yyyy ? 0 : 4} size="sm" />
          </span>
        </SRow>
        {note('dob')}
      </div>
      <div ref={el => { rows.current.maxHr = el }} className="st-rowwrap">
        <SRow label="Max heart rate" sub="From your birth date until real runs raise it." onClick={() => setCard('maxHr')} ariaLabel={`Max heart rate${maxHr != null ? `, ${maxHr}` : ', not set'}. Change`}>
          <FlapLabel text={maxHr != null ? String(maxHr) : ''} len={maxHr != null ? 0 : 3} size="sm" tone="gold" />
        </SRow>
        {note('maxHr')}
      </div>
      <div ref={el => { rows.current.injuries = el }} className="st-rowwrap">
        <SBlock label="Back and pain" sub="What the coach should keep in mind.">
          <textarea
            className="st-nt is-coach"
            aria-label="Back and pain"
            maxLength={1000}
            placeholder="Lower back stiffness. Right shoulder occasionally."
            value={injuries}
            onChange={e => setInjuries(e.target.value)}
          />
        </SBlock>
        {note('injuries')}
      </div>
    </Board>

    {/* the cards sit outside the board: its backdrop blur would hold a fixed scrim inside it */}

      {card === 'dob' && (
        <DobCard
          value={dob ?? defaultDob}
          onCancel={() => setCard(null)}
          onDone={v => { setCard(null); void save('dob', { dob: formatDob(v) }) }}
        />
      )}
      {card === 'maxHr' && (
        <NumberCard
          title="Max heart rate"
          value={maxHr ?? 186}
          min={120}
          max={230}
          unit="BPM"
          onCancel={() => setCard(null)}
          onDone={v => { setCard(null); void save('maxHr', { maxHr: v }) }}
          extra={profile?.maxHr != null && dob ? { label: 'FROM BIRTH DATE', onClick: () => { setCard(null); void save('maxHr', { maxHr: null }) } } : undefined}
        />
      )}
    </>
  )
}
