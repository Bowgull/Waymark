// Pure logic for the picker boards (design-decisions.md, "Pickers and flows",
// pages 20 and 22): the Add Session / More options departures board, the
// Replace signpost's three roads, and the Why skip / Why swap reason boards.
// No React and no image imports, so the unit tests run it under node.

import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import type { ReplaceSuggestion } from '@/lib/prompts/tools'

import { sessionIconFor, type SessionIconKey } from '../../design/sessionIconKeys'

export type Slot = 'am' | 'pm'

/** What a picker hands back on a pick (the SessionPicker onSelect contract). */
export interface SessionOption {
  type: string
  label: string
  timeSlot: Slot
  runCategory?: string
}

export interface PickerOption extends SessionOption {
  flexibleTimeSlot: boolean
}

/** pick = lantern-lit coach pick, ember = caution, plain = everything else. */
export type DepartureTone = 'pick' | 'ember' | 'plain'

export interface DepartureRow extends PickerOption {
  /** type, or type:runCategory (runs split by category). */
  key: string
  icon: SessionIconKey
  /** The reason line under the name. Neutral rows carry none. */
  reason: string | null
  tone: DepartureTone
}

export interface DepartureBoard {
  /** Coach picks, lit by the lantern (no gold dots). */
  picks: DepartureRow[]
  /** "Everything else": neutral rows and ember cautions. */
  rest: DepartureRow[]
  /** The flags line ("Soreness is high · Sleep is low"), or null. */
  flagsLine: string | null
  /** Pad names to this many tiles so the board lines up (never cuts longer names). */
  labelLen: number
}

/** MT Class is booked outside the app, so it never appears on a picker. */
export const PICKER_EXCLUDED_TYPES: ReadonlySet<string> = new Set(['mt_class'])

/** Names pad to at most this many tiles (page 20 / 22 rows use 11). */
export const LABEL_PAD_MAX = 11

export function optionKey(opt: { type: string; runCategory?: string }): string {
  return opt.runCategory ? `${opt.type}:${opt.runCategory}` : opt.type
}

/** Picker options from the training targets (single source of truth), MT Class out. */
export function pickerOptions(
  targets: ReadonlyArray<{ type: string; label: string; defaultTimeSlot: Slot; flexibleTimeSlot: boolean; runCategory?: string }>,
): PickerOption[] {
  return targets
    .filter(t => !PICKER_EXCLUDED_TYPES.has(t.type))
    .map(t => ({
      type: t.type,
      label: t.label,
      timeSlot: t.defaultTimeSlot,
      flexibleTimeSlot: t.flexibleTimeSlot,
      runCategory: t.runCategory,
    }))
}

function plainRow(opt: PickerOption): DepartureRow {
  return { ...opt, key: optionKey(opt), icon: sessionIconFor(opt.type, opt.runCategory), reason: null, tone: 'plain' }
}

function padFor(rows: DepartureRow[]): number {
  const longest = rows.reduce((n, r) => Math.max(n, r.label.length), 0)
  return Math.min(LABEL_PAD_MAX, longest)
}

/**
 * Build the departures board. Same rules as the app's picker today:
 * - no suggestions (or an empty list): every option, plain, no flags line
 * - suggestions: only the suggested options that are on the base list, in
 *   the order given (suggested, neutral, caution); coach picks first with
 *   their reason; the rest show a reason only when it's a caution (an ember)
 * - suggestions that match nothing on the base list: every option, plain,
 *   with the flags line
 * - MT Class never appears
 */
export function buildDepartures(base: ReadonlyArray<PickerOption>, suggestions?: SuggestionsResponse | null): DepartureBoard {
  const options = base.filter(o => !PICKER_EXCLUDED_TYPES.has(o.type))
  if (!suggestions || suggestions.suggestions.length === 0) {
    const rest = options.map(plainRow)
    return { picks: [], rest, flagsLine: null, labelLen: padFor(rest) }
  }
  const flagsLine = suggestions.flags.length > 0 ? suggestions.flags.join(' · ') : null
  const byKey = new Map(options.map(o => [optionKey(o), o]))
  const rows: DepartureRow[] = []
  for (const s of suggestions.suggestions) {
    if (PICKER_EXCLUDED_TYPES.has(s.type)) continue
    const baseOpt = byKey.get(optionKey(s))
    if (!baseOpt) continue
    const tone: DepartureTone = s.priority === 'suggested' ? 'pick' : s.priority === 'caution' ? 'ember' : 'plain'
    rows.push({
      type: s.type,
      label: s.label,
      timeSlot: s.timeSlot,
      runCategory: s.runCategory,
      flexibleTimeSlot: s.flexibleTimeSlot ?? baseOpt.flexibleTimeSlot ?? false,
      key: optionKey(s),
      icon: sessionIconFor(s.type, s.runCategory),
      reason: tone === 'plain' ? null : (s.reason ?? null),
      tone,
    })
  }
  if (rows.length === 0) {
    const rest = options.map(plainRow)
    return { picks: [], rest, flagsLine, labelLen: padFor(rest) }
  }
  const picks = rows.filter(r => r.tone === 'pick')
  const rest = rows.filter(r => r.tone !== 'pick')
  return { picks, rest, flagsLine, labelLen: padFor(rows) }
}

export function flipSlot(slot: Slot): Slot {
  return slot === 'am' ? 'pm' : 'am'
}

/** The pick handed to onSelect. A fixed-slot session always keeps its own slot. */
export function selectionFor(row: DepartureRow, slot: Slot): SessionOption {
  return { type: row.type, label: row.label, timeSlot: row.flexibleTimeSlot ? slot : row.timeSlot, runCategory: row.runCategory }
}

// ─── Replace signpost: the coach's three roads ───────────────

export const SIGNPOST_ROADS = 3

export interface SignpostRoad {
  suggestion: ReplaceSuggestion
  icon: SessionIconKey
  /** The coach's first choice is lit. */
  lit: boolean
}

/** Only the coach's top 3 go on the post (MT Class never), the first one lit. */
export function signpostRoads(suggestions: ReadonlyArray<ReplaceSuggestion> | null | undefined): SignpostRoad[] {
  return (suggestions ?? [])
    .filter(s => !PICKER_EXCLUDED_TYPES.has(s.type))
    .slice(0, SIGNPOST_ROADS)
    .map((s, i) => ({ suggestion: s, icon: sessionIconFor(s.type, s.runCategory), lit: i === 0 }))
}

// ─── Why skip: the numbered reason board ─────────────────────

export type SkipReasonValue =
  | 'too_sore'
  | 'tired'
  | 'injury'
  | 'schedule'
  | 'sick'
  | 'low_drive'
  | 'other'

/** The codes the server receives (unchanged), and the words on each row. */
export const SKIP_REASONS: ReadonlyArray<{ value: SkipReasonValue; label: string }> = [
  { value: 'too_sore', label: 'Sore' },
  { value: 'tired', label: 'Tired' },
  { value: 'injury', label: 'Injury / pain' },
  { value: 'schedule', label: 'Time' },
  { value: 'sick', label: 'Sick' },
  { value: 'low_drive', label: 'Low motivation' },
  { value: 'other', label: 'Other' },
]

/** The seven real places (plain list, no body map). Sent as written here. */
export const SKIP_PLACES: ReadonlyArray<string> = ['Lower back', 'Knee', 'Hip', 'Shoulder', 'Ankle', 'Neck', 'Other']

export interface SkipReasonCommit {
  reason: SkipReasonValue
  detail: string | null
}

/** Does this choice still need a few words? (Other, or Injury at Other.) */
export function skipNeedsWords(reason: SkipReasonValue | null, place: string | null): boolean {
  return reason === 'other' || (reason === 'injury' && place === 'Other')
}

/**
 * The commit for a complete choice, or null while it isn't complete
 * (COMMIT stays off). Injury needs a place; Other (and Injury at Other)
 * needs a few words. The detail is exactly what the app sent before.
 */
export function skipCommit(reason: SkipReasonValue | null, place: string | null, words: string): SkipReasonCommit | null {
  if (!reason) return null
  const text = words.trim()
  if (reason === 'injury') {
    if (!place) return null
    if (place === 'Other') return text ? { reason, detail: text } : null
    return { reason, detail: place }
  }
  if (reason === 'other') return text ? { reason, detail: text } : null
  return { reason, detail: null }
}

/** Two-digit departures numbering: 01, 02 … */
export function boardNumber(i: number): string {
  return String(i + 1).padStart(2, '0')
}

// ─── Why swap ────────────────────────────────────────────────

/** The six real reasons. The label is what the server receives. */
export const REPLACE_REASONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'too_sore', label: 'Too sore' },
  { value: 'low_sleep', label: 'Low on sleep' },
  { value: 'schedule', label: 'Short on time' },
  { value: 'low_drive', label: 'Not feeling it' },
  { value: 'illness', label: 'Body signal' },
  { value: 'variety', label: 'Changing it up' },
]

/** What ReplaceReasonSheet's onCommit receives: the label, and the fast path for "Changing it up". */
export function replaceCommit(value: string): { reason: string; fastPath: boolean } {
  const found = REPLACE_REASONS.find(r => r.value === value)
  return { reason: found?.label ?? value, fastPath: value === 'variety' }
}
