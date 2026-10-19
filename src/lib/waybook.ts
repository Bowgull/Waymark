// The Waybook's pages (page 46): the journal's reflections plus the morning notes written on the
// check-in (+ ADD NOTE saves them to the day's daily log, `daily_logs.notes`). One book, one place
// to read; the morning notes carry type 'morning' so the page tags them MORNING. Pure.

export interface WaybookEntry {
  id: string
  /** Epoch day. */
  date: number
  type: string
  content: string
  /** Unix seconds. */
  createdAt: number
}

export interface MorningNoteLog {
  id: string
  logDate: number
  notes: string | null
  createdAt: number
}

export const MORNING_ENTRY_TYPE = 'morning'

/** The day's morning note as a Waybook entry (blank notes are left out). */
export function morningNoteEntries(logs: ReadonlyArray<MorningNoteLog>, fromDay: number): WaybookEntry[] {
  return logs
    .filter(l => l.logDate >= fromDay && typeof l.notes === 'string' && l.notes.trim().length > 0)
    .map(l => ({ id: `morning-${l.id}`, date: l.logDate, type: MORNING_ENTRY_TYPE, content: l.notes!.trim(), createdAt: l.createdAt }))
}

/** Reflections and morning notes together, newest day first. */
export function waybookEntries(journal: ReadonlyArray<WaybookEntry>, logs: ReadonlyArray<MorningNoteLog>, fromDay: number): WaybookEntry[] {
  return [...journal, ...morningNoteEntries(logs, fromDay)].sort((a, b) => b.date - a.date || b.createdAt - a.createdAt)
}
