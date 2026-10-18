// Estimated one-rep max. R4 (LeSuer 1997): rep-based equations are only
// accurate up to ~10 reps, so anything past that returns null instead of a
// confident wrong number.

export const E1RM_MAX_REPS = 10

function validInput(weightKg: number, reps: number): boolean {
  return Number.isFinite(weightKg) && weightKg > 0 && Number.isFinite(reps) && reps >= 1 && reps <= E1RM_MAX_REPS
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Epley: w × (1 + reps/30). One rep returns the weight itself. */
export function epley(weightKg: number, reps: number): number | null {
  if (!validInput(weightKg, reps)) return null
  if (reps === 1) return round1(weightKg)
  return round1(weightKg * (1 + reps / 30))
}

/** Brzycki: w × 36 / (37 − reps). */
export function brzycki(weightKg: number, reps: number): number | null {
  if (!validInput(weightKg, reps)) return null
  return round1(weightKg * 36 / (37 - reps))
}

/**
 * RIR-adjusted e1RM: reps done plus reps left in the tank = reps to failure,
 * fed to Epley. The 10-rep limit applies to that total, so a set of 8 with
 * 3 left (11 to failure) returns null. That is why Block Zero uses a 3-5 rep
 * check set for the estimate (R4).
 */
export function e1rmFromRir(weightKg: number, reps: number, rir: number): number | null {
  if (!Number.isFinite(rir) || rir < 0) return null
  return epley(weightKg, reps + rir)
}

/** RPE-adjusted e1RM (RIR = 10 − RPE, Zourdos 2016). */
export function e1rmFromRpe(weightKg: number, reps: number, rpe: number): number | null {
  if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) return null
  return e1rmFromRir(weightKg, reps, 10 - rpe)
}

/** RPE ↔ RIR on the reps-in-reserve scale (RPE 10 = 0 left). */
export function rirFromRpe(rpe: number): number {
  return Math.max(0, 10 - rpe)
}
