// 409 refusals from the placement rules (insert-ad-hoc, replace, move,
// adjustments/:id/accept) carry { reason, code, safeAlternatives }. The
// client used to swallow them; these helpers turn the body into one line the
// existing toast can show. Pure: no imports from the fetch layer.

export type RefusalAlternative =
  | { kind: 'day'; date: string; timeSlot: 'am' | 'pm'; epochDay?: number }
  | { kind: 'swap'; type: string; label: string; date: string; timeSlot: 'am' | 'pm'; epochDay?: number; notes?: string | null }

export interface Refusal {
  reason: string
  code: string | null
  safeAlternatives: RefusalAlternative[]
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayName(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? isoDate : DAY_SHORT[d.getUTCDay()]
}

/** The refusal in an ApiError-shaped error (status + body), or null. */
export function parseRefusal(err: unknown): Refusal | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { status?: unknown; body?: unknown }
  if (e.status !== 409 && e.status !== 400) return null
  if (typeof e.body !== 'string' || e.body.length === 0) return null
  let parsed: { reason?: unknown; error?: unknown; code?: unknown; safeAlternatives?: unknown }
  try {
    parsed = JSON.parse(e.body)
  } catch {
    return null
  }
  const reason = typeof parsed.reason === 'string' ? parsed.reason : typeof parsed.error === 'string' ? parsed.error : null
  if (!reason) return null
  const alts = Array.isArray(parsed.safeAlternatives) ? parsed.safeAlternatives as RefusalAlternative[] : []
  return {
    reason,
    code: typeof parsed.code === 'string' ? parsed.code : null,
    safeAlternatives: alts.filter(a => a && (a.kind === 'day' || a.kind === 'swap') && typeof a.date === 'string'),
  }
}

/** "Wed AM" for a safe day, "Reset Wed PM" for an easier swap. */
export function describeAlternative(a: RefusalAlternative): string {
  const when = `${dayName(a.date)} ${a.timeSlot.toUpperCase()}`
  return a.kind === 'swap' ? `${a.label} ${when}` : when
}

/** The reason, then up to three safe alternatives. */
export function refusalMessage(r: Refusal, max = 3): string {
  const reason = r.reason.trim().replace(/\.?$/, '.')
  if (r.safeAlternatives.length === 0) return reason
  const alts = r.safeAlternatives.slice(0, max).map(describeAlternative)
  return `${reason} Safe options: ${alts.join(', ')}.`
}
