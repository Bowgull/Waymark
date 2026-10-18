// The coach's asks as the approved centred flap board (page 36): the question
// on a flap (a big icon for a session ask), one line of why, the proof as teal
// tiles, the choices as departure rows (icon, flap label, a sub-line, AM/PM
// where it matters), flap buttons. Pure: maps a GET /api/adjustments row to
// what the board shows and what each choice sends to
// POST /api/adjustments/:id/accept ({ option, slot }) or /reject.

import { sessionIconFor, SESSION_ICON_NAME, type SessionIconKey } from '@/design/sessionIconKeys'

export interface AskRow {
  id: string
  adjustmentType: string
  sessionType?: string | null
  reason: string
  status?: string
  options?: unknown[] | null
  detail?: Record<string, unknown> | null
}

export interface AskChoice {
  key: string
  /** Flap label: plain words that say what happens. */
  title: string
  sub: string | null
  icon: SessionIconKey | null
  slot: 'am' | 'pm' | null
  /** What accepting this choice sends. Null = decline (POST /reject). */
  body: { option: number; slot?: number } | null
}

export interface TmLiftView {
  exerciseId: string
  name: string
  currentKg: number
  proposedKg: number
  minKg: number
  maxKg: number
  stepKg: number
}

export interface AskView {
  id: string
  kind: 'ramp_up' | 'make_regular' | 'missed_session' | 'tm_update'
  /** The headline flap. */
  flap: string
  /** The big icon over the flap (a session ask). */
  hero: SessionIconKey | null
  /** One line: the question / why. */
  line: string
  /** The facts behind it: a teal flap (the label) and the plain fact beside it. */
  proof: Array<{ label: string; value: string }>
  choices: AskChoice[]
  /** The primary button. */
  go: string
  /** The quiet button, or null when a choice row is itself the no. */
  decline: { title: string } | null
  /** Short line for the Coach board row on Today. */
  rowLine: string
  tm: TmLiftView[] | null
}

const ASK_KINDS = new Set(['ramp_up', 'make_regular', 'missed_session', 'tm_update'])

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const slotOf = (v: unknown): 'am' | 'pm' | null => (v === 'am' || v === 'pm' ? v : null)
const iconFor = (type: unknown, notes?: unknown): SessionIconKey | null => (typeof type === 'string' && type ? sessionIconFor(type, typeof notes === 'string' ? notes : null) : null)

function nameOf(type: string | null | undefined, label?: string | null): string {
  if (label) return label
  if (!type) return 'the session'
  return SESSION_ICON_NAME[sessionIconFor(type)]
}

/** "SUN AM" from a YYYY-MM-DD date and a slot. */
export function dayFlap(date: string, slot: 'am' | 'pm' | null): string {
  const d = new Date(`${date}T12:00:00Z`)
  const day = Number.isNaN(d.getTime()) ? '' : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()]
  return [day, slot?.toUpperCase()].filter(Boolean).join(' ')
}

export function isAsk(row: AskRow): boolean {
  return ASK_KINDS.has(row.adjustmentType) && (row.status == null || row.status === 'proposed')
}

export function askView(row: AskRow): AskView | null {
  if (!isAsk(row)) return null
  const opts = Array.isArray(row.options) ? (row.options as Array<Record<string, unknown>>) : []
  const detail = row.detail ?? {}

  if (row.adjustmentType === 'ramp_up') {
    const proof = Array.isArray(detail.proof) ? (detail.proof as Array<Record<string, unknown>>).map(p => ({ label: str(p.label).toUpperCase(), value: str(p.value) })).filter(p => p.label || p.value) : []
    const choices: AskChoice[] = opts.map((o, i) => ({
      key: str(o.id) || `opt-${i}`,
      title: str(o.title) || `OPTION ${i + 1}`,
      sub: str(o.detail) || null,
      icon: o.kind === 'add' ? iconFor(o.type, o.notes) : 'strength',
      slot: o.kind === 'add' ? slotOf(o.timeSlot) : null,
      body: { option: i },
    }))
    const decline = detail.decline && typeof detail.decline === 'object' ? str((detail.decline as Record<string, unknown>).title) : ''
    return {
      id: row.id, kind: 'ramp_up', flap: 'PUSH THIS WEEK?', hero: null,
      line: str(detail.why) || row.reason, proof, choices, go: 'DO IT', decline: { title: decline || 'NOT THIS WEEK' },
      rowLine: 'Push a little this week?', tm: null,
    }
  }

  if (row.adjustmentType === 'make_regular') {
    const cand = (detail.candidate ?? {}) as Record<string, unknown>
    const type = str(cand.type) || row.sessionType || ''
    const hero = iconFor(type, cand.notes)
    const name = nameOf(type, str(cand.label) || null)
    const choices: AskChoice[] = []
    opts.forEach((o, i) => {
      if (o.id === 'another_day' && Array.isArray(o.safeSlots)) {
        // ANOTHER DAY: one row per safe slot, each answering with that slot
        ;(o.safeSlots as Array<Record<string, unknown>>).forEach((s, k) => choices.push({
          key: `another-${k}`, title: str(s.label) || 'ANOTHER DAY', sub: 'Another safe day, every week', icon: hero, slot: slotOf(s.timeSlot), body: { option: i, slot: k },
        }))
        return
      }
      if (o.kind === 'keep_extra') { choices.push({ key: 'keep_extra', title: str(o.title) || "I'LL ADD IT MYSELF", sub: str(o.detail) || null, icon: null, slot: null, body: { option: i } }); return }
      const slot = o.slot && typeof o.slot === 'object' ? slotOf((o.slot as Record<string, unknown>).timeSlot) : null
      choices.push({ key: str(o.id) || `opt-${i}`, title: str(o.title) || 'EVERY WEEK', sub: str(o.detail) || null, icon: hero, slot, body: { option: i } })
    })
    return {
      id: row.id, kind: 'make_regular', flap: name.toUpperCase(), hero,
      line: str(detail.why) ? `${str(detail.why)} Make it part of the plan?` : row.reason,
      proof: num(cand.weeks) > 0 ? [{ label: `${num(cand.weeks)} WEEKS RUNNING`, value: '' }] : [], choices, go: 'DONE', decline: null,
      rowLine: `Make ${name.toLowerCase()} part of the plan?`, tm: null,
    }
  }

  if (row.adjustmentType === 'missed_session') {
    const type = row.sessionType ?? ''
    const hero = iconFor(type)
    const name = nameOf(type)
    const choices: AskChoice[] = opts.map((o, i) => {
      if (o.kind === 'drop') return { key: 'drop', title: 'DROP IT', sub: 'Let it go. The week carries on.', icon: null, slot: null, body: { option: i } }
      const slot = slotOf(o.timeSlot)
      const when = dayFlap(str(o.date), slot)
      if (o.kind === 'swap') return { key: `swap-${i}`, title: when || 'ANOTHER DAY', sub: `As ${nameOf(str(o.type), str(o.label) || null)}`, icon: iconFor(o.type, o.notes), slot, body: { option: i } }
      return { key: `move-${i}`, title: when || 'ANOTHER DAY', sub: `Move ${name} there`, icon: hero, slot, body: { option: i } }
    })
    return {
      id: row.id, kind: 'missed_session', flap: name.toUpperCase(), hero,
      line: row.reason, proof: [], choices, go: 'DONE', decline: null,
      rowLine: `You missed ${name}. Fit it in?`, tm: null,
    }
  }

  // tm_update: old → new per lift, adjust, then hold to approve
  const lifts = Array.isArray(detail.lifts) ? detail.lifts as Array<Record<string, unknown>> : (opts[0] && Array.isArray(opts[0].lifts) ? opts[0].lifts as Array<Record<string, unknown>> : [])
  const tm: TmLiftView[] = lifts.map(l => ({
    exerciseId: str(l.exerciseId), name: str(l.name).toUpperCase(),
    currentKg: num(l.currentKg), proposedKg: num(l.proposedKg), minKg: num(l.minKg, num(l.proposedKg)), maxKg: num(l.maxKg, num(l.proposedKg)), stepKg: num(l.stepKg, 2.5) || 2.5,
  }))
  return {
    id: row.id, kind: 'tm_update', flap: 'NEW TARGETS', hero: null,
    line: row.reason, proof: [], choices: [{ key: 'approve', title: 'HOLD TO APPROVE', sub: null, icon: null, slot: null, body: { option: 0 } }],
    go: 'HOLD TO APPROVE', decline: { title: 'KEEP THE OLD ONES' }, rowLine: 'New training maxes?', tm,
  }
}

/** One lift's value after a − / + tap, kept inside the rule bounds. */
export function stepTm(lift: TmLiftView, valueKg: number, dir: -1 | 1): number {
  const next = Math.round((valueKg + dir * lift.stepKg) * 100) / 100
  return Math.min(lift.maxKg, Math.max(lift.minKg, next))
}

/** The accept body for the training maxes: per-lift values in kg. */
export function tmAcceptBody(values: Record<string, number>): { option: number; values: Record<string, number> } {
  return { option: 0, values }
}

/** Asks first on open: the oldest open question. */
export function firstAsk(rows: AskRow[]): AskView | null {
  for (const r of rows) { const v = askView(r); if (v) return v }
  return null
}
