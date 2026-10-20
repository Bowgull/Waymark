import { useRef } from 'react'

import { CentredCard, FlapButton, FlapLabel, SessionIcon } from '@/design'

import { CLASS_MIN, CLASS_TYPES, clampClassMinutes, type ClassTypeValue } from './classType'

/**
 * The MT Class Log (page 31, "MT Class Log"): one centred board over the
 * forest. CLASS TYPE flap chips (the lit one gold), CLASS LENGTH (MIN) on a
 * − / + stepper, WHAT TO WORK ON, then SAVE CLASS LOG. A type the coach
 * refuses (Block Zero: sparring, clinch too early, the weekly cap) turns clay
 * with its line under the chips. Controlled: MtClassLogView owns the state.
 */
export function MtClassLogCard({
  classType,
  minutes,
  note,
  refused,
  error,
  saving,
  onType,
  onMinutes,
  onNote,
  onSave,
  onClose,
}: {
  classType: ClassTypeValue
  minutes: number
  note: string
  /** A type the server refused, with its one-line reason. */
  refused: { type: ClassTypeValue; reason: string } | null
  /** A save that failed for another reason (connection). */
  error: string | null
  saving: boolean
  onType: (t: ClassTypeValue, chips: HTMLElement | null) => void
  onMinutes: (m: number) => void
  onNote: (text: string) => void
  onSave: (button: HTMLElement | null) => void
  onClose?: () => void
}) {
  const chipsRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef<HTMLDivElement>(null)
  return (
    <CentredCard label="MT Class Log" head="MT Class Log" headRight={<SessionIcon kind="mt" size={34} />} onDismiss={saving ? undefined : onClose} closeOnOutside={false} className="wm-mtlog">
      <div className="wm-mlabel">CLASS TYPE</div>
      <div ref={chipsRef} className="wm-types" role="radiogroup" aria-label="Class type">
        {CLASS_TYPES.map(t => {
          const on = classType === t.value
          const isRefused = refused?.type === t.value
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={`wm-ty${on ? ' is-on' : ''}${isRefused ? ' is-refused' : ''}`}
              disabled={saving}
              onClick={() => onType(t.value, chipsRef.current)}
            >
              <FlapLabel text={t.label} size="xs" tone={isRefused ? 'clay' : on ? 'gold' : 'ink'} />
            </button>
          )
        })}
        {refused && <p className="wm-row-note" role="alert">{refused.reason}</p>}
      </div>

      <div className="wm-mlabel" style={{ marginTop: 10 }}>CLASS LENGTH (MIN)</div>
      <div className="wm-stepper" role="group" aria-label="Class length in minutes">
        <button type="button" aria-label="Shorter" disabled={saving || minutes <= CLASS_MIN.min} onClick={() => onMinutes(clampClassMinutes(minutes - CLASS_MIN.step))}>−</button>
        <span className="v" aria-live="polite"><FlapLabel text={String(minutes)} size="lg" /></span>
        <button type="button" aria-label="Longer" disabled={saving || minutes >= CLASS_MIN.max} onClick={() => onMinutes(clampClassMinutes(minutes + CLASS_MIN.step))}>+</button>
      </div>

      <div className="wm-mlabel" style={{ marginTop: 10 }}>WHAT TO WORK ON</div>
      <textarea
        className="wm-fld-in"
        rows={2}
        maxLength={1000}
        value={note}
        onChange={e => onNote(e.target.value)}
        placeholder="e.g. Guard dropping after combos"
        aria-label="What to work on"
      />

      <div ref={saveRef} className="wm-btns" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <FlapButton label="SAVE CLASS LOG" primary disabled={saving} onClick={() => onSave(saveRef.current)} />
        {error && <p className="wm-row-note" role="alert">{error}</p>}
      </div>
    </CentredCard>
  )
}
