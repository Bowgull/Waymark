import { useState } from 'react'

import { AmPmFlap, CentredCard, FlapButton, FlapLabel } from '@/design'
import { FlapNumber, VDrum } from './settingsParts'
import { MONTHS3, clampYmd, joinTime, splitTime, stepHour, stepMinute, type Ymd } from './settingsModel'

// The centred cards Settings opens. The time card is page 37's "The time
// card" exactly; the others use the same drums and DONE (page 45 asks for
// "the approved time-card style drums" for birth date and max HR).

/** Page 37 "The time card": hour and minute drums, the AM/PM flap, DONE. */
export function TimeCard({ title, value, onDone, onCancel }: { title: string; value: string; onDone: (hhmm: string) => void; onCancel: () => void }) {
  const init = splitTime(value)
  const [h, setH] = useState(init.h12)
  const [m, setM] = useState(init.mm)
  const [slot, setSlot] = useState<'am' | 'pm'>(init.slot)
  return (
    <CentredCard head={title} label={title} onDismiss={onCancel}>
      <div className="st-tpick">
        <VDrum label="Hour" value={String(h)} onUp={() => setH(v => stepHour(v, 1))} onDown={() => setH(v => stepHour(v, -1))} />
        <span className="st-colon" aria-hidden>:</span>
        <VDrum label="Minutes" value={String(m).padStart(2, '0')} onUp={() => setM(v => stepMinute(v, 5))} onDown={() => setM(v => stepMinute(v, -5))} />
        <AmPmFlap slot={slot} size="md" onChange={setSlot} />
      </div>
      <p className="st-tsub">Tap {slot === 'am' ? 'AM' : 'PM'} to flip it to {slot === 'am' ? 'PM' : 'AM'}.</p>
      <div className="wm-btns">
        <FlapButton label="DONE" primary onClick={() => onDone(joinTime(h, m, slot))} />
      </div>
    </CentredCard>
  )
}

/**
 * One number on a drum (Remind me, an episode, max HR): ▲ ▼ step it, tap
 * the flap to type it, its unit beside it, DONE.
 */
export function NumberCard({ title, sub, value, min, max, step = 1, unit, onDone, onCancel, extra }: {
  title: string
  sub?: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onDone: (v: number) => void
  onCancel: () => void
  extra?: { label: string; onClick: () => void }
}) {
  const [text, setText] = useState(String(value))
  const n = Number(text)
  const valid = text !== '' && Number.isInteger(n) && n >= min && n <= max
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const bump = (d: number) => setText(String(clamp((Number.isFinite(n) && text !== '' ? n : value) + d)))
  return (
    <CentredCard head={title} label={title} onDismiss={onCancel} sub={sub}>
      <div className="st-tpick">
        <VDrum label={title} onUp={() => bump(step)} onDown={() => bump(-step)}>
          <FlapNumber value={text} onChange={v => setText(v.replace(/\D/g, '').slice(0, String(max).length))} label={title} />
        </VDrum>
        {unit && <FlapLabel text={unit} size="md" />}
      </div>
      <div className="wm-btns">
        {extra && <FlapButton label={extra.label} size="xs" onClick={extra.onClick} />}
        <FlapButton label="DONE" primary disabled={!valid} onClick={() => onDone(n)} />
      </div>
    </CentredCard>
  )
}

/** Birth date (page 45): day, month and year drums, DONE. */
export function DobCard({ value, onDone, onCancel }: { value: Ymd; onDone: (v: Ymd) => void; onCancel: () => void }) {
  const [v, setV] = useState<Ymd>(value)
  const thisYear = new Date().getFullYear()
  const set = (next: Ymd) => setV(clampYmd(next))
  const wrap = (x: number, lo: number, hi: number) => (x > hi ? lo : x < lo ? hi : x)
  const dim = new Date(Date.UTC(v.y, v.m, 0)).getUTCDate()
  return (
    <CentredCard head="Birth date" label="Birth date" onDismiss={onCancel}>
      <div className="st-tpick">
        <VDrum label="Day" value={String(v.d)} onUp={() => set({ ...v, d: wrap(v.d + 1, 1, dim) })} onDown={() => set({ ...v, d: wrap(v.d - 1, 1, dim) })} />
        <VDrum label="Month" value={MONTHS3[v.m - 1]} onUp={() => set({ ...v, m: wrap(v.m + 1, 1, 12) })} onDown={() => set({ ...v, m: wrap(v.m - 1, 1, 12) })} />
        <VDrum label="Year" value={String(v.y)} onUp={() => set({ ...v, y: Math.min(thisYear - 10, v.y + 1) })} onDown={() => set({ ...v, y: Math.max(thisYear - 100, v.y - 1) })} />
      </div>
      <div className="wm-btns">
        <FlapButton label="DONE" primary onClick={() => onDone(v)} />
      </div>
    </CentredCard>
  )
}

/** An arc: every arc as a flap chip, the current one gold, DONE. */
export function ArcCard({ title, arcs, value, onDone, onCancel }: { title: string; arcs: readonly string[]; value: string; onDone: (arc: string) => void; onCancel: () => void }) {
  const [pick, setPick] = useState(value)
  return (
    <CentredCard head={title} label={title} onDismiss={onCancel}>
      <div className="st-arcs" role="radiogroup" aria-label={title}>
        {arcs.map(a => {
          const on = a === pick
          return (
            <button key={a} type="button" role="radio" aria-checked={on} aria-label={a} className={`st-chip${on ? ' is-on' : ''}`} onClick={() => setPick(a)}>
              <FlapLabel text={a.toUpperCase()} size="xs" tone={on ? 'gold' : 'ink'} fit />
            </button>
          )
        })}
      </div>
      <div className="wm-btns">
        <FlapButton label="DONE" primary onClick={() => onDone(pick)} />
      </div>
    </CentredCard>
  )
}
