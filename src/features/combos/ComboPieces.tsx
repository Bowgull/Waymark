import { Fragment, useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import { FlapLabel } from '@/design'
import { LEVELS, type ComboLevel, type ReadToken } from '@/lib/classCombos'
import { comboStrikes } from '@/features/library/libraryModel'

import './combos.css'

// The pieces page 80 shares: a combo as the app's strike flaps, the one
// difficulty flap, the typed combo's read-back (unknown words in clay) and the
// Waymark slate he types on.

const LV_CLASS = ['is-easy', 'is-med', 'is-hard', 'is-expert'] as const

/** The difficulty in plain words on one coloured flap: EASY teal, MEDIUM gold, HARD orange, EXPERT ember. */
export function LevelFlap({ level }: { level: ComboLevel }) {
  return (
    <span className="cmb-lvl">
      <FlapLabel text={LEVELS[level]} size="xs" animate={false} className={`cmb-lv ${LV_CLASS[level]}`} />
    </span>
  )
}

/** A combo's strikes, one flap each, joined by ›. */
export function ComboFlaps({ text, size = 'xs' }: { text: string; size?: 'xs' | 'sm' }) {
  const strikes = comboStrikes(text)
  return (
    <span className="cmb-strikes" role="img" aria-label={strikes.join(', ')}>
      {strikes.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="cmb-arr" aria-hidden>›</span>}
          <span className="cmb-stk"><FlapLabel text={s} size={size} animate={false} /></span>
        </Fragment>
      ))}
    </span>
  )
}

/** A combo row: only the strikes and the difficulty (page 80: mastery stays on the combo's own page). */
export function ComboLine({ text, level }: { text: string; level: ComboLevel }) {
  return (
    <span className="cmb-cline">
      <ComboFlaps text={text} />
      <LevelFlap level={level} />
    </span>
  )
}

/** The typed combo read back: known strikes as flaps, an unknown word in clay (tap it for fixes). */
export function ReadFlaps({ tokens, onUnknown }: { tokens: ReadonlyArray<ReadToken>; onUnknown: (i: number) => void }) {
  return (
    <span className="cmb-strikes">
      {tokens.map((t, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="cmb-arr" aria-hidden>›</span>}
          {t.kind === 'strike'
            ? <span className="cmb-stk"><FlapLabel text={t.name.toUpperCase()} size="xs" animate={false} /></span>
            : (
              <span className="cmb-stk is-unk" role="button" tabIndex={0} aria-label={`${t.raw}: not a strike the app knows`}
                onClick={e => { e.stopPropagation(); onUnknown(i) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onUnknown(i) } }}>
                <FlapLabel text={t.raw.toUpperCase()} size="xs" tone="clay" animate={false} />
              </span>
            )}
        </Fragment>
      ))}
    </span>
  )
}

/**
 * The Waymark slate (page 80): a dark inset plate, mono capitals, a gold rule
 * that brightens while he types, and a gold block caret that blinks after the
 * letters (the system caret is hidden). No placeholder, no web-form look.
 */
export function Slate({ value, onChange, label, onEnter, autoFocus = false, variant }: { value: string; onChange: (v: string) => void; label: string; onEnter?: () => void; autoFocus?: boolean; variant?: 'flat' | 'srch' }) {
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const sync = useCallback(() => {
    const sl = box.current, inp = input.current
    if (!sl || !inp) return
    const mir = sl.querySelector<HTMLElement>('.mir'), caret = sl.querySelector<HTMLElement>('.caretb')
    if (!mir || !caret) return
    mir.textContent = inp.value.slice(0, inp.selectionStart ?? inp.value.length)
    caret.style.left = `${Math.max(12, Math.min(12 + mir.offsetWidth - inp.scrollLeft, sl.clientWidth - 14))}px`
  }, [])
  useLayoutEffect(sync, [value, sync])
  useEffect(() => {
    if (!autoFocus) return
    const inp = input.current
    if (!inp) return
    inp.focus({ preventScroll: true })
    inp.setSelectionRange(inp.value.length, inp.value.length)
    sync()
  }, [autoFocus, sync])
  return (
    <div ref={box} className={`cmb-slate${variant ? ` is-${variant}` : ''}`}>
      <input
        ref={input}
        value={value}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        enterKeyHint="done"
        maxLength={120}
        onChange={e => onChange(e.target.value)}
        onKeyUp={sync}
        onClick={sync}
        onSelect={sync}
        onFocus={sync}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.() } }}
      />
      <span className="mir" aria-hidden />
      <i className="caretb" aria-hidden />
    </div>
  )
}
