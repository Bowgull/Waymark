// Missed sessions -> ask (plan: "ask me each time"; F14: never cram).
// When a session is missed the coach builds one pending question with only
// safe options: let it go, move it to a day this week that passes every
// placement rule, or swap it for an easier session. Nothing is rescheduled
// until the athlete answers. The question lapses at the end of that week. Pure.

import { checkSessionChange, easierOptions, type PlacementContext } from './placement'
import { DAY_NAMES, dowOf, isoOf, mondayOf, sessionName, type SessionLike, type TimeSlot } from './sessions'

export type MissedOption =
  | { kind: 'drop' }
  | { kind: 'move'; epochDay: number; date: string; timeSlot: TimeSlot }
  | { kind: 'swap'; type: string; label: string; notes?: string | null; epochDay: number; date: string; timeSlot: TimeSlot }

export interface MissedAsk {
  options: MissedOption[]
  /** Epoch day after the week's Sunday: the ask lapses at its start. */
  expiresOnDay: number
  /** One line for the card, house voice. */
  reason: string
  /** The default for a plain Accept: the first move, else drop. */
  defaultOption: MissedOption
}

const MAX_MOVE_DAYS = 3

const name = sessionName

export function missedSessionOptions(missed: SessionLike, ctx: PlacementContext): MissedAsk {
  const monday = mondayOf(missed.epochDay)
  const sunday = monday + 6
  const first = Math.max(ctx.todayEpochDay, monday)
  const options: MissedOption[] = [{ kind: 'drop' }]
  const base = { kind: 'add' as const, type: missed.type, label: missed.label ?? null, notes: missed.notes ?? null, estimatedMin: missed.estimatedMin ?? null, sessionId: missed.id ?? null }

  const moves: MissedOption[] = []
  for (let d = first; d <= sunday && moves.length < MAX_MOVE_DAYS; d++) {
    for (const slot of [missed.timeSlot, missed.timeSlot === 'am' ? 'pm' : 'am'] as TimeSlot[]) {
      const r = checkSessionChange({ ...base, epochDay: d, timeSlot: slot }, ctx, { alternatives: false })
      if (r.ok) {
        moves.push({ kind: 'move', epochDay: d, date: isoOf(d), timeSlot: r.change.timeSlot })
        break
      }
    }
  }
  options.push(...moves)

  for (const opt of easierOptions(missed, ctx.blockType)) {
    let placed: MissedOption | null = null
    for (let d = first; d <= sunday && !placed; d++) {
      for (const slot of ['am', 'pm'] as TimeSlot[]) {
        const r = checkSessionChange({ ...base, ...opt, estimatedMin: null, epochDay: d, timeSlot: slot }, ctx, { alternatives: false })
        if (r.ok) {
          placed = { kind: 'swap', type: opt.type, label: opt.label, ...(opt.notes ? { notes: opt.notes } : {}), epochDay: d, date: isoOf(d), timeSlot: r.change.timeSlot }
          break
        }
      }
    }
    if (placed) {
      options.push(placed)
      break
    }
  }

  const what = `${name(missed)} on ${DAY_NAMES[dowOf(missed.epochDay)]} was missed.`
  const firstMove = moves[0]
  const reason = firstMove && firstMove.kind === 'move'
    ? `${what} ${DAY_NAMES[dowOf(firstMove.epochDay)]} ${firstMove.timeSlot.toUpperCase()} is a safe slot. Accept moves it there. Dismiss lets it go.`
    : `${what} No safe day left this week. Let it go.`
  return { options, expiresOnDay: sunday + 1, reason, defaultOption: firstMove ?? { kind: 'drop' } }
}
