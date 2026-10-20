// Page 64: the start day's two requests. CHANGE DAY moves a waiting Block
// Zero; both it and BEGIN then prepare the start's week.

import { apiFetch } from '@/lib/api'
import { epochDayToISO, mondayOf } from '@/lib/dates'

/** The Monday of a day's week, as YYYY-MM-DD. */
const mondayISO = (day: number) => epochDayToISO(mondayOf(day))

/** Prepares the start's week (as BEGIN does): the lead-in from a mid-week start, or week 1 from a Monday. */
export async function prepareStartWeek<W = unknown>(blockId: string, startDay: number, today: string): Promise<W> {
  return apiFetch<W>('/api/weeks/generate', {
    method: 'POST',
    body: JSON.stringify({ blockId, weekNumber: 1, startDate: mondayISO(startDay), today }),
  })
}

/** CHANGE DAY → SAVE: the waiting block moves to the new day, then its week is prepared. */
export async function moveStartDay<B extends { id: string }>(blockId: string, startDay: number, today: string): Promise<B> {
  const block = await apiFetch<B>(`/api/blocks/${blockId}/start-day`, {
    method: 'POST',
    body: JSON.stringify({ startDate: epochDayToISO(startDay), today }),
  })
  await prepareStartWeek(block.id, startDay, today)
  return block
}
