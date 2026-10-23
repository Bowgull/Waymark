// MT class day slots (page 70 layout A, approved by Josh 2026-10-21). Pure,
// shared by Settings and the coach. settings.mt_class_slots holds
// "mon:pm,sat:any"; settings.mt_class_days still lists the days. A lit day
// with no saved slot reads as its default: PM on weekdays, ANY on Saturday
// and Sunday. The app never changes his choice by itself.

export type ClassDaySlot = 'am' | 'pm' | 'any'

const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** A newly lit day (and a saved day with no slot yet): ANY on the weekend, PM on weekdays. */
/**
 * Settings' class days ("1,3,5", 0 = Sunday) as day numbers. Null and '' are
 * the same: no class days picked, no classes (audit 2026-10-23 #30; never a
 * Mon/Wed/Fri fallback).
 */
export function parseClassDays(raw: string | null | undefined): number[] {
  return [...new Set((raw ?? '').split(',').map(x => x.trim()).filter(Boolean).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))]
}

export function defaultClassSlot(dow: number): ClassDaySlot {
  return dow === 0 || dow === 6 ? 'any' : 'pm'
}

/** The flap's next face: AM → PM → ANY → AM. */
export function nextClassSlot(s: ClassDaySlot): ClassDaySlot {
  return s === 'am' ? 'pm' : s === 'pm' ? 'any' : 'am'
}

/** Saved slots by weekday (0 = Sunday); unknown parts are ignored. */
export function parseClassSlots(raw: string | null | undefined): Partial<Record<number, ClassDaySlot>> {
  const out: Partial<Record<number, ClassDaySlot>> = {}
  for (const part of (raw ?? '').split(',')) {
    const [k, v] = part.trim().toLowerCase().split(':')
    const dow = KEYS.indexOf(k as (typeof KEYS)[number])
    if (dow >= 0 && (v === 'am' || v === 'pm' || v === 'any')) out[dow] = v
  }
  return out
}

/** "mon:pm,sat:any" for the lit days, in week order (Monday first). */
export function formatClassSlots(days: Iterable<number>, slots: Partial<Record<number, ClassDaySlot>>): string {
  const lit = [...new Set(days)].filter(d => d >= 0 && d <= 6).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  return lit.map(d => `${KEYS[d]}:${slots[d] ?? defaultClassSlot(d)}`).join(',')
}

/** The slot for each lit day: his saved choice, else the default. */
export function classDaySlots(days: Iterable<number>, raw: string | null | undefined): Record<number, ClassDaySlot> {
  const saved = parseClassSlots(raw)
  const out: Record<number, ClassDaySlot> = {}
  for (const d of days) if (d >= 0 && d <= 6) out[d] = saved[d] ?? defaultClassSlot(d)
  return out
}

/**
 * Page 76 (approved 2026-10-23): one flap per day in Settings. A day is OFF
 * (no class) or lit with its slot; a tap goes OFF → AM → PM → ANY → OFF.
 */
export type ClassDayState = 'off' | ClassDaySlot

const CYCLE: readonly ClassDayState[] = ['off', 'am', 'pm', 'any']

/** The day tile's next face: OFF → AM → PM → ANY → OFF. */
export function nextClassDayState(s: ClassDayState): ClassDayState {
  return CYCLE[(CYCLE.indexOf(s) + 1) % CYCLE.length]
}

/** What a day's tile shows: OFF when the day isn't picked, else its saved slot (or the default). */
export function classDayState(days: ReadonlySet<number>, slots: Partial<Record<number, ClassDaySlot>>, dow: number): ClassDayState {
  return days.has(dow) ? slots[dow] ?? defaultClassSlot(dow) : 'off'
}

/** Days and slots after setting one day's state (same shapes Settings saves as mtClassDays / mtClassSlots). */
export function withClassDayState(
  days: ReadonlySet<number>,
  slots: Partial<Record<number, ClassDaySlot>>,
  dow: number,
  state: ClassDayState,
): { days: Set<number>; slots: Partial<Record<number, ClassDaySlot>> } {
  const nextDays = new Set(days)
  const nextSlots = { ...slots }
  if (state === 'off') {
    nextDays.delete(dow)
    delete nextSlots[dow]
  } else {
    nextDays.add(dow)
    nextSlots[dow] = state
  }
  return { days: nextDays, slots: nextSlots }
}

/** The tap: the day's next state applied. */
export function cycleClassDay(days: ReadonlySet<number>, slots: Partial<Record<number, ClassDaySlot>>, dow: number) {
  return withClassDayState(days, slots, dow, nextClassDayState(classDayState(days, slots, dow)))
}

/** The spoken word for a state ("Monday class: morning. Change"). */
export function classDayWord(s: ClassDayState): string {
  return s === 'am' ? 'morning' : s === 'pm' ? 'evening' : s === 'any' ? 'either' : 'off'
}
