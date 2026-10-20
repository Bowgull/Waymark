// The Waybook's Face ID rule (approved 2026-10-19; page 61 part 1). Pure, so
// the unit tests run it under node; waybookGate.ts wires it to the plugin.
//
// - Tapping Waybook asks for Face ID (passcode as the fallback, iOS's own prompt).
// - Not again within 3 minutes of the Waybook last being open...
// - ...unless the phone locked or he left the app since (the window drops at once).
// - On by default; the web build has no Face ID and opens without asking.

export const WAYBOOK_WINDOW_MS = 3 * 60 * 1000

export interface WaybookLockState {
  /** The Settings switch ("Face ID for the Waybook"). */
  enabled: boolean
  /** A native build (the web build has no Face ID). */
  native: boolean
  /** When the Waybook was last open (ms), or null: never, or the app went to the background since. */
  lastOpenAt: number | null
}

export function needsFaceId(s: WaybookLockState, now: number): boolean {
  if (!s.enabled || !s.native) return false
  if (s.lastOpenAt == null) return true
  return now - s.lastOpenAt > WAYBOOK_WINDOW_MS
}

/** The stored switch: on unless turned off ('0'). */
export function gateEnabledFrom(stored: string | null): boolean {
  return stored !== '0'
}

export type FaceIdOutcome = 'open' | 'stay' | 'open-unprotected'

/**
 * What a failed prompt means (the plugin's error codes). Cancel leaves it
 * closed. No passcode on the phone: nothing to check with, so it opens (and
 * says so once) rather than lock him out of his own journal.
 */
export function outcomeForError(code: string | undefined): FaceIdOutcome {
  if (code === 'passcodeNotSet' || code === 'noDeviceCredential') return 'open-unprotected'
  return 'stay'
}
