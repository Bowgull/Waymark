// Every lock card's grass (page 82, approved): the grass is the system's own
// progress fill (it never sways), with a steady soft glow in the moment's
// colour and one brighter glow on each change that eases back once. The widget
// can't loop or keep time, so the app sends the moment's colour (glowTone) and
// a change counter (glowSeq): when the counter moves, the card flashes once.
// A colour change alone (bag work's and the timer's orange) never flashes.
//
// On a run the recorder changes the zone by itself while the phone is locked;
// the widget folds the zone (and the run's time being reached) into the flash
// itself, so these counters only move where the app changes the moment.
//
// Card by card (page 82's table):
//   Zone 2 Run       teal in zone, gold at the top, ember over; flash on a zone
//                    change and when the run's time is reached
//   Run-Walk         the zone's colour while running, teal walking; each switch
//   Tempo/Intervals  gold RUN HARD, teal EASY JOG, ember well over; each piece
//   Bag work         gold round, teal rest, orange last 10 s; round and rest start
//   Strength         teal; when the rest ends
//   Holds/Foundation teal hold, gold move; when each hold ends
//   Skip rope        gold rope, teal rest; each change
//   Reset            calm teal; each part change
//   Interval timer   gold work, teal rest and get ready, orange near the end; each part

import type { HrZone } from './hrZoneState'

export type GlowTone = 'teal' | 'gold' | 'ember' | 'orange'

export interface LockGlow {
  glowTone: GlowTone
  glowSeq: number
}

/** The zone's colour on a run: teal in zone, gold at the top, ember over; no reading keeps today's gold. */
export function zoneTone(zone: HrZone | null | undefined): GlowTone {
  return zone === 'in' ? 'teal' : zone === 'over' ? 'ember' : 'gold'
}

/** Zone 2 Run: the zone's colour; the counter moves once, when the run's time is reached. */
export function zone2Glow(zone: HrZone | null | undefined, timeReached: boolean): LockGlow {
  return { glowTone: zoneTone(zone), glowSeq: timeReached ? 1 : 0 }
}

/** Run-Walk: piece `index` (0-based); teal walking, the zone's colour running. */
export function runWalkGlow(index: number, walking: boolean, zone: HrZone | null | undefined): LockGlow {
  return { glowTone: walking ? 'teal' : zoneTone(zone), glowSeq: Math.max(0, index) + 1 }
}

/** Tempo / Intervals: piece `index` (0-based); ember well over, teal easy, gold hard. */
export function hardRunGlow(index: number, easy: boolean, over: boolean): LockGlow {
  return { glowTone: over ? 'ember' : easy ? 'teal' : 'gold', glowSeq: Math.max(0, index) + 1 }
}

/** Bag work: round `round` (1-based) and the rest after it. Orange (last 10 s) changes only the colour. */
export function bagGlow(round: number, resting: boolean, lastTen: boolean): LockGlow {
  const r = Math.max(1, round)
  return { glowTone: lastTen ? 'orange' : resting ? 'teal' : 'gold', glowSeq: 2 * r - 1 + (resting ? 1 : 0) }
}

/** Skip rope: as bag work, without the orange. */
export function ropeGlow(round: number, resting: boolean): LockGlow {
  const r = Math.max(1, round)
  return { glowTone: resting ? 'teal' : 'gold', glowSeq: 2 * r - 1 + (resting ? 1 : 0) }
}

/**
 * Strength: teal. `setOrdinal` counts every set of the session so far
 * (1-based, the one being done or just done): the rest after a set keeps its
 * number and the set after the rest moves it, so it flashes when the rest ends.
 */
export function strengthGlow(setOrdinal: number): LockGlow {
  return { glowTone: 'teal', glowSeq: Math.max(1, setOrdinal) }
}

/**
 * Holds / Foundation: hold `hold` (1-based). The counter moves when a hold
 * ends (between holds), not when the next one starts.
 */
export function holdsGlow(hold: number, holding: boolean, moving = false): LockGlow {
  const h = Math.max(1, hold)
  return { glowTone: moving ? 'gold' : 'teal', glowSeq: holding ? h - 1 : h }
}

/** Reset: part `part` (1-based: walk, hips, roller), calm teal. */
export function resetGlow(part: number): LockGlow {
  return { glowTone: 'teal', glowSeq: Math.max(1, part) }
}

/** The interval timer: part `index` (0-based, get ready first). Orange changes only the colour. */
export function intervalGlow(index: number, ph: 'ready' | 'work' | 'rest', warn: boolean): LockGlow {
  return { glowTone: warn ? 'orange' : ph === 'work' ? 'gold' : 'teal', glowSeq: Math.max(0, index) + 1 }
}

/** Does going from `a` to `b` flash the card? Only a moved counter does. */
export function flashes(a: LockGlow | null | undefined, b: LockGlow): boolean {
  return !!a && a.glowSeq !== b.glowSeq
}
