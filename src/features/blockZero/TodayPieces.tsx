import { useRef, useState } from 'react'

import { Board, CentredCard, FlapButton, FlapChip, FlapLabel, glowRow } from '@/design'

import { CHECK_IN_QUESTIONS, answerLabel, answeredCount, type CheckInAnswers, type CheckInKey } from './checkInFlow'
import type { ReadinessLineView } from './readinessLine'

const SUMMARY_KEYS: CheckInKey[] = ['sleepHours', 'energy', 'soreness', 'backToday']
const SUMMARY_WORD: Partial<Record<CheckInKey, string>> = { sleepHours: 'Sleep', energy: 'Energy', soreness: 'Soreness', backToday: 'Back' }

/**
 * The Morning Report, collapsed on Today (it stays here to edit). Not logged
 * yet: one CHECK IN button opens the cards. Logged: a short summary; tap a
 * value to change just that answer.
 */
export function MorningReportCard({
  answers,
  onCheckIn,
  onEdit,
  onAddNote,
}: {
  answers: CheckInAnswers | null
  onCheckIn: () => void
  onEdit: (questionIndex: number) => void
  onAddNote: () => void
}) {
  const logged = answers != null && answeredCount(answers) > 0
  if (!logged) {
    return (
      <Board head="Morning report">
        <p className="wm-prose is-dim" style={{ marginBottom: 10 }}>Nine taps. The coach reads it before today&apos;s work.</p>
        <FlapButton label="CHECK IN" primary onClick={onCheckIn} />
      </Board>
    )
  }
  return (
    <Board head="Morning report" headRight={<FlapLabel text="LOGGED" size="xs" tone="teal" />}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SUMMARY_KEYS.filter(k => answers[k] != null).map(k => (
          <button
            key={k}
            type="button"
            className="wm-chip"
            onClick={() => onEdit(CHECK_IN_QUESTIONS.findIndex(q => q.key === k))}
            aria-label={`${SUMMARY_WORD[k]}: ${answerLabel(k, answers[k] as number)}. Tap to change.`}
          >
            <span className="wm-label">{SUMMARY_WORD[k]}</span>
            <span className="wm-num">{answerLabel(k, answers[k] as number)}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <FlapChip label="EDIT" onClick={() => onEdit(0)} />
        <FlapChip label="+ NOTE" onClick={onAddNote} />
      </div>
    </Board>
  )
}

/** A note for the day, saved to the Waybook as before (POST /api/journal, type wellness). */
export function MorningNoteCard({ onSave, onClose }: { onSave: (text: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <CentredCard label="Add a note" head="Morning report" sub="How does the body feel?" onDismiss={saving ? undefined : onClose}>
      <textarea className="wm-input" rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="How does the body feel..." autoFocus />
      <div className="wm-btns">
        <FlapButton label="CLOSE" onClick={onClose} disabled={saving} />
        <FlapButton
          label="SAVE"
          primary
          disabled={saving || !text.trim()}
          onClick={async () => {
            setSaving(true)
            const ok = await onSave(text.trim())
            setSaving(false)
            if (ok) onClose()
          }}
        />
      </div>
    </CentredCard>
  )
}

/**
 * Today's hero line: the readiness read (tap to see why) and the quick
 * "class tonight" add. Minimal hero card for step 1; the world's hero
 * treatment (and the lantern) come with step 2.
 */
export function TodayHeroCard({
  line,
  showClassChip,
  classAdded,
  onAddClass,
}: {
  line: ReadinessLineView | null
  showClassChip: boolean
  classAdded: boolean
  onAddClass: (chip: HTMLElement | null) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const chipRow = useRef<HTMLDivElement>(null)
  if (!line && !showClassChip) return null
  return (
    <Board edge={line?.tone === 'bad' ? 'bad' : 'none'}>
      {line && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{ display: 'flex', width: '100%', alignItems: 'flex-start', gap: 8, padding: '4px 0', minHeight: 44, background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
        >
          <span aria-hidden style={{ color: line.tone === 'bad' ? '#d9906e' : '#8fd4b8', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 16, lineHeight: '23px' }}>◆</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="wm-prose">{line.text}</span>
            {open && <span className="wm-prose is-dim">{line.why}</span>}
          </span>
        </button>
      )}
      {showClassChip && (
        <div ref={chipRow} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: line ? 8 : 0 }}>
          <FlapChip
            label={classAdded ? '✓ CLASS TONIGHT' : '+ CLASS TONIGHT'}
            tone={classAdded ? 'teal' : 'ink'}
            disabled={classAdded || busy}
            onClick={async () => {
              setBusy(true)
              setRefusal(null)
              const refused = await onAddClass(chipRow.current)
              setBusy(false)
              if (refused) {
                setRefusal(refused)
                glowRow(chipRow.current, 'bad')
              } else {
                glowRow(chipRow.current, 'good')
              }
            }}
          />
          {refusal && <p className="wm-row-note">{refusal}</p>}
        </div>
      )}
    </Board>
  )
}
