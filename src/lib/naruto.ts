// Naruto (original series, 220 episodes) progress for indoor runs.

export const NARUTO_EPISODES = 220

/** Average episode length used to turn run minutes into episodes watched. */
export const NARUTO_EP_MIN = 23

/** Runs shorter than this never ask about episodes. */
export const NARUTO_MIN_RUN_MIN = 15

// Episode -> arc. APPROXIMATE: arc boundaries vary between guides and the
// filler run after 135 is lumped into one block. Good enough to label where
// you are; the arc stays editable in Settings.
export const NARUTO_ARCS = [
  { name: 'Land of Waves', first: 1, last: 19 },
  { name: 'Chunin Exams', first: 20, last: 67 },
  { name: 'Konoha Crush', first: 68, last: 80 },
  { name: 'Search for Tsunade', first: 81, last: 100 },
  { name: 'Land of Tea (filler)', first: 101, last: 106 },
  { name: 'Sasuke Recovery', first: 107, last: 135 },
  { name: 'Filler', first: 136, last: 220 },
] as const

export const NARUTO_ARC_NAMES: readonly string[] = NARUTO_ARCS.map(a => a.name)

/** The arc an episode falls in, or null when out of range. */
export function narutoArcForEp(ep: number | null | undefined): string | null {
  if (ep == null || !Number.isInteger(ep)) return null
  return NARUTO_ARCS.find(a => ep >= a.first && ep <= a.last)?.name ?? null
}

/**
 * Where the Settings episode drum opens: the saved episode when it sits in the
 * chosen arc, else the arc's first episode (e2e minor 19: picking Chunin Exams
 * then opening the drum at 1 snapped the arc back to Land of Waves).
 */
export function narutoEpDrumStart(arc: string | null | undefined, ep: number | null | undefined): number {
  const a = NARUTO_ARCS.find(x => x.name === arc)
  const valid = ep != null && Number.isInteger(ep) && ep >= 1 && ep <= NARUTO_EPISODES
  if (!a) return valid ? ep : 1
  return valid && ep >= a.first && ep <= a.last ? ep : a.first
}

/**
 * Episodes watched during a run: round(minutes / 23), at least 1 when the run
 * was 15 min or more, 0 below that (0 = no prompt).
 */
export function narutoEpisodesWatched(runSec: number | null | undefined): number {
  if (runSec == null || !Number.isFinite(runSec) || runSec <= 0) return 0
  const minutes = runSec / 60
  if (minutes < NARUTO_MIN_RUN_MIN) return 0
  return Math.max(1, Math.round(minutes / NARUTO_EP_MIN))
}

/** Clamp an episode number into 1..220. */
export function clampNarutoEp(ep: number): number {
  if (!Number.isFinite(ep)) return 1
  return Math.min(NARUTO_EPISODES, Math.max(1, Math.round(ep)))
}

/** The episode you are on after watching n more. Unset counts as before ep 1. */
export function narutoNextEp(current: number | null | undefined, watched: number): number {
  const base = current != null && Number.isFinite(current) ? current : 0
  return clampNarutoEp(base + watched)
}

export type NarutoPatch = { narutoArc?: string | null; narutoEp?: number | null }

/**
 * Validate the Naruto fields of a PATCH /api/settings body. Absent fields stay
 * absent; null (or '') clears. narutoEp must be an integer 1..220 (numeric
 * strings accepted); narutoArc must be one of NARUTO_ARC_NAMES.
 */
export function validateNarutoPatch(body: Record<string, unknown>):
  { ok: true; updates: NarutoPatch } | { ok: false; error: string } {
  const updates: NarutoPatch = {}
  if (body.narutoEp !== undefined) {
    const raw = body.narutoEp
    if (raw === null || raw === '') {
      updates.narutoEp = null
    } else {
      const n = typeof raw === 'number' ? raw
        : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw)
        : NaN
      if (!Number.isInteger(n) || n < 1 || n > NARUTO_EPISODES) {
        return { ok: false, error: `narutoEp must be an integer 1-${NARUTO_EPISODES}` }
      }
      updates.narutoEp = n
    }
  }
  if (body.narutoArc !== undefined) {
    const raw = body.narutoArc
    if (raw === null || raw === '') {
      updates.narutoArc = null
    } else if (typeof raw === 'string' && NARUTO_ARC_NAMES.includes(raw)) {
      updates.narutoArc = raw
    } else {
      return { ok: false, error: 'narutoArc must be a known arc name' }
    }
  }
  return { ok: true, updates }
}
