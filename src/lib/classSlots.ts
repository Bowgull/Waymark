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
