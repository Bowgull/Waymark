// The approved pop-up for his own change (page 35 A; page 56: SWAPPED / ADDED
// with "Bag work tonight."). The coach's changes get no pop-up, only a rune.

import { sessionDisplayName } from '../dayboard/rowState'

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function pickToast(title: 'SWAPPED' | 'ADDED' | 'MOVED', s: { type: string; label?: string | null; notes?: string | null; timeSlot?: string | null; scheduledDate?: number | null }, todayDay: number): { title: string; text: string } {
  const name = sessionDisplayName({ type: s.type, label: s.label ?? null, notes: s.notes ?? null })
  const words = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
  const when = s.scheduledDate == null || s.scheduledDate === todayDay
    ? (s.timeSlot === 'pm' ? 'tonight' : 'this morning')
    : `on ${DAY_LONG[new Date(s.scheduledDate * 86400000).getUTCDay()]}`
  return { title, text: `${words} ${when}.` }
}
