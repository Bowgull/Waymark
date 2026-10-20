import { useRef } from 'react'

import { CentredCard, FlapButton, FlapLabel, SessionIcon } from '@/design'

import { CLASS_TYPES, type ClassTypeValue } from './classType'

/**
 * The MT Class Log (page 31, "MT Class Log"): one centred board over the
 * forest. CLASS TYPE flap chips (the lit one gold), WHAT TO WORK ON, then
 * SAVE CLASS LOG. No length: every class logs as a fixed hour. The type is what he
 * logs about the class: the coach never refuses or judges it (what is taught
 * is the gym's call). Controlled: MtClassLogView owns the state.
 */
export function MtClassLogCard({
  classType,
  note,
  error,
  saving,
  onType,
  onNote,
  onSave,
  onClose,
}: {
  classType: ClassTypeValue
  note: string
  /** A save that failed for another reason (connection). */
  error: string | null
  saving: boolean
  onType: (t: ClassTypeValue, chips: HTMLElement | null) => void
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
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={`wm-ty${on ? ' is-on' : ''}`}
              disabled={saving}
              onClick={() => onType(t.value, chipsRef.current)}
            >
              <FlapLabel text={t.label} size="xs" tone={on ? 'gold' : 'ink'} />
            </button>
          )
        })}
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
