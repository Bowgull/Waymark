// Pure logic for the picker board (design-decisions.md, "Pickers and flows",
// pages 20 and 22; page 56, approved 2026-10-19): the Add Session departures
// board, which REPLACE opens too, and the optional reason tiles on REPLACE and
// SKIP. Every row can be picked, MT Class included; nothing is refused,
// greyed out or previewed. No React and no image imports, so the unit tests
// run it under node.

import type { SessionSuggestion, SuggestionsResponse } from '@/lib/sessionSuggestions'

import { sessionIconFor, type SessionIconKey } from '../../design/sessionIconKeys'

export type Slot = 'am' | 'pm'

/** What a picker hands back on a pick (the SessionPicker onSelect contract). */
export interface SessionOption {
  type: string
  label: string
  timeSlot: Slot
  runCategory?: string
  /** An add, or the week's next strength pulled to this day; absent means a plain add. */
  action?: SessionSuggestion['action']
}

export interface PickerOption extends SessionOption {
  flexibleTimeSlot: boolean
}

/** pick = lantern-lit coach pick, plain = everything else. */
export type DepartureTone = 'pick' | 'plain'

export interface DepartureRow extends PickerOption {
  /** type, or type:runCategory (runs split by category). */
  key: string
  icon: SessionIconKey
  /** The coach pick's reason line ("Easy, 20 min"). Other rows carry none. */
  reason: string | null
  tone: DepartureTone
}

export interface DepartureBoard {
  /** Coach picks, lit by the lantern (no gold dots). */
  picks: DepartureRow[]
  /** "Everything else": every other session, plain. */
  rest: DepartureRow[]
  /** Pad names to this many tiles so the board lines up (never cuts longer names). */
  labelLen: number
}

/** Names pad to at most this many tiles (page 20 / 22 rows use 11; page 56 uses 15). */
export const LABEL_PAD_MAX = 15

export function optionKey(opt: { type: string; runCategory?: string }): string {
  return opt.runCategory ? `${opt.type}:${opt.runCategory}` : opt.type
}

/** Picker options from the training targets (single source of truth), MT Class included (page 56 item 15). */
export function pickerOptions(
  targets: ReadonlyArray<{ type: string; label: string; defaultTimeSlot: Slot; flexibleTimeSlot: boolean; runCategory?: string }>,
): PickerOption[] {
  return targets.map(t => ({
    type: t.type,
    label: t.label,
    timeSlot: t.defaultTimeSlot,
    flexibleTimeSlot: t.flexibleTimeSlot,
    runCategory: t.runCategory,
  }))
}

function plainRow(opt: PickerOption, over: Partial<DepartureRow> = {}): DepartureRow {
  return { ...opt, key: optionKey(opt), icon: sessionIconFor(opt.type, opt.runCategory), reason: null, tone: 'plain', ...over }
}

function padFor(rows: DepartureRow[]): number {
  const longest = rows.reduce((n, r) => Math.max(n, r.label.length), 0)
  return Math.min(LABEL_PAD_MAX, longest)
}

/**
 * Build the board:
 * - no suggestions: every option, plain
 * - suggestions: the coach's picks first with their reason, then every other
 *   option on the base list, plain (no reason, nothing greyed out, no ember)
 * - the pick's action (add / pull forward) travels with its row
 */
export function buildDepartures(base: ReadonlyArray<PickerOption>, suggestions?: SuggestionsResponse | null, opts: { pmOnly?: boolean } = {}): DepartureBoard {
  const board = buildBoard(base, suggestions)
  if (!opts.pmOnly) return board
  // Today after the morning (M3): the AM slot has gone, so every row is PM.
  const pm = (r: DepartureRow): DepartureRow => ({ ...r, timeSlot: 'pm', ...(r.action ? { action: { ...r.action, timeSlot: 'pm' } } : {}) })
  return { ...board, picks: board.picks.map(pm), rest: board.rest.map(pm) }
}

/** Past noon on the day itself, the AM slot has gone: the board offers PM. */
export function pmOnlyFor(date: string, today: string, hour: number): boolean {
  return date === today && hour >= 12
}

function buildBoard(base: ReadonlyArray<PickerOption>, suggestions?: SuggestionsResponse | null): DepartureBoard {
  const list = suggestions?.suggestions ?? []
  const byKey = new Map(list.map(s => [optionKey(s), s]))
  const picks: DepartureRow[] = []
  const rest: DepartureRow[] = []
  for (const s of list) {
    if (s.priority !== 'suggested') continue
    const opt = base.find(o => optionKey(o) === optionKey(s))
    if (!opt) continue
    picks.push(plainRow({ ...opt, label: s.label, timeSlot: s.timeSlot, flexibleTimeSlot: s.flexibleTimeSlot ?? opt.flexibleTimeSlot }, { tone: 'pick', reason: s.reason ?? null, ...(s.action ? { action: s.action } : {}) }))
  }
  const picked = new Set(picks.map(p => p.key))
  // The rest in the server's order (what is already on that day goes last), then anything it left out.
  const order = new Map(list.map((s, i) => [optionKey(s), i]))
  const ordered = [...base].sort((a, b) => (order.get(optionKey(a)) ?? list.length) - (order.get(optionKey(b)) ?? list.length))
  for (const opt of ordered) {
    if (picked.has(optionKey(opt))) continue
    const s = byKey.get(optionKey(opt))
    rest.push(plainRow(s ? { ...opt, label: s.label, timeSlot: s.timeSlot, flexibleTimeSlot: s.flexibleTimeSlot ?? opt.flexibleTimeSlot } : opt, s?.action ? { action: s.action } : {}))
  }
  return { picks, rest, labelLen: padFor([...picks, ...rest]) }
}

export function flipSlot(slot: Slot): Slot {
  return slot === 'am' ? 'pm' : 'am'
}

/** The pick handed to onSelect. A fixed-slot session always keeps its own slot. */
export function selectionFor(row: DepartureRow, slot: Slot): SessionOption {
  const timeSlot = row.flexibleTimeSlot ? slot : row.timeSlot
  const action = row.action ? { ...row.action, timeSlot } : undefined
  return { type: row.type, label: row.label, timeSlot, runCategory: row.runCategory, ...(action ? { action } : {}) }
}

// ─── Optional reason tiles (page 56 items 1-3) ───────────────

export interface ReasonTile {
  /** The code the server receives. */
  value: string
  /** The words on the tile's flap. */
  label: string
}

/** On REPLACE: the six real reasons plus ROUGH DAY, first. */
export const REPLACE_REASONS: ReadonlyArray<ReasonTile> = [
  { value: 'rough_day', label: 'ROUGH DAY' },
  { value: 'too_sore', label: 'TOO SORE' },
  { value: 'low_sleep', label: 'LOW ON SLEEP' },
  { value: 'schedule', label: 'SHORT ON TIME' },
  { value: 'low_drive', label: 'NOT FEELING IT' },
  { value: 'illness', label: 'BODY SIGNAL' },
  { value: 'variety', label: 'CHANGING IT UP' },
]

/** On SKIP: the skip reasons plus ROUGH DAY, first. INJURY / PAIN opens the seven places. */
export const SKIP_REASONS: ReadonlyArray<ReasonTile> = [
  { value: 'rough_day', label: 'ROUGH DAY' },
  { value: 'too_sore', label: 'SORE' },
  { value: 'tired', label: 'TIRED' },
  { value: 'injury', label: 'INJURY / PAIN' },
  { value: 'schedule', label: 'TIME' },
  { value: 'sick', label: 'SICK' },
  { value: 'low_drive', label: 'LOW MOTIVATION' },
  { value: 'other', label: 'OTHER' },
]

/**
 * Ending a run or bag session early (coach brain P2): one optional tap, the
 * same tiles as SKIP. NO TIME holds the next dose; it never reads as too hard.
 */
export const EARLY_END_REASONS: ReadonlyArray<ReasonTile> = [
  { value: 'no_time', label: 'NO TIME' },
  { value: 'rough', label: 'FELT ROUGH' },
  { value: 'pain', label: 'PAIN / BODY' },
  { value: 'other', label: 'OTHER' },
]

/** Skipping a class the coach suggested: its time not fitting is its own reason (never "too hard"). */
export const CLASS_SKIP_REASONS: ReadonlyArray<ReasonTile> = [
  { value: 'schedule', label: 'NO TIME' },
  { value: 'class_time', label: "CLASS TIME DOESN'T FIT" },
  ...SKIP_REASONS.filter(r => r.value !== 'schedule'),
]

/** The seven real places (plain list, no body map). Sent as written here. */
export const SKIP_PLACES: ReadonlyArray<string> = ['Lower back', 'Knee', 'Hip', 'Shoulder', 'Ankle', 'Neck', 'Other']

/** One tap lights a tile; a tap on the lit one clears it. */
export function toggleTile(current: string | null, value: string): string | null {
  return current === value ? null : value
}

/**
 * REPLACE leaves out the session being replaced. A run-walk is not Zone 2
 * (page 56 1B lists ZONE 2 when replacing the run-walk), so only an exact
 * match goes.
 */
export function replaceKeeps(target: { type: string; label?: string | null; notes?: string | null }, opt: { type: string; runCategory?: string }): boolean {
  const sameType = opt.type === target.type && (opt.runCategory ?? null) === (target.type === 'running' ? target.notes ?? null : null)
  if (!sameType) return true
  return target.type === 'foundation_run' && /run-walk/i.test(target.label ?? '')
}
