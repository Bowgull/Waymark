import { COMBO_CUE_CONTENT } from './comboCueContent'

/**
 * The bag round's cue (page 47): the combo's own written form tip, cut to a
 * few words for a teal flap under the strikes (CUE · TURN THE HIP). Nothing
 * here is AI-written.
 *
 * Every combo in the library has a hand-picked cue, taken from its own
 * form_tips (the tip's words, cut down). The map is keyed by combo id, so the
 * cue holds whichever version of the tip a database has (the seed and the
 * older migrations word a few tips slightly differently). A combo that is not
 * in the map gets one derived from its tip: the first imperative clause, at
 * most four words.
 */

/** At most this many words on the cue flap. */
export const CUE_MAX_WORDS = 4
/** At most this many characters, so the flap fits beside CUE on a phone. */
export const CUE_MAX_CHARS = 20

export const COMBO_CUES: Readonly<Record<string, string>> = {
  // Foundation
  'combo-f01': 'ROTATE THE HIP',
  'combo-f02': 'KEEP THE HOOK TIGHT',
  'combo-f03': 'MAKE BOTH JABS SNAP',
  'combo-f04': 'RESET BEATS SPEED',
  'combo-f05': 'DROP YOUR LEVEL',
  'combo-f06': 'FEEL THE TRANSFER',
  'combo-f07': 'DRIVE THE HIP',
  'combo-f08': 'RETRACT FULLY',
  'combo-f09': 'PIVOT THE BASE FOOT',
  'combo-f10': 'BEND THE KNEES',
  // Weapons
  'combo-w01': 'TURN THE HIP OVER',
  'combo-w02': 'SNAP THE SWITCH',
  'combo-w03': 'CHOP DOWN THROUGH',
  'combo-w04': 'PLANT AND RESET',
  'combo-w05': 'PUSH WITH THE HIP',
  'combo-w06': 'LEAN SLIGHTLY AWAY',
  'combo-w07': 'STEP IN BEHIND JAB',
  'combo-w08': 'SNAP THE FEET',
  'combo-w09': 'FLOW INTO THE HANDS',
  'combo-w10': 'HIP DRIVES THE KNEE',
  'combo-w11': 'CLOSE THE GAP',
  'combo-w12': 'DO NOT OVERCOMMIT',
  'combo-w13': 'PLANT BEFORE KICK',
  'combo-w14': 'SAME HIP TURN',
  'combo-w15': 'COMMIT TO THE KICK',
  'combo-w16': 'HIP DRIVES',
  'combo-w17': 'DROP THE HEEL',
  'combo-w18': 'CHECK IS A STRIKE',
  // Flow
  'combo-fl01': 'DO NOT PLANT FLAT',
  'combo-fl02': 'JABS WALK YOU IN',
  'combo-fl03': 'STEP AT AN ANGLE',
  'combo-fl04': 'DIP, THEN RISE',
  'combo-fl05': 'HANDS BACK TO GUARD',
  'combo-fl06': 'PIVOT ON LEAD FOOT',
  'combo-fl07': 'KICK SETS THE RANGE',
  'combo-fl08': 'CONTROL THE RHYTHM',
  // Defence
  'combo-d01': 'COMMIT THE SHOULDER',
  'combo-d02': 'LIFT THE KNEE',
  'combo-d03': 'ATTACK HIGH',
  'combo-d04': 'LIFT THE CHECK SHARP',
  'combo-d05': 'MOVE YOUR FEET',
  'combo-d06': 'PUNISH THE ADVANCE',
  'combo-d07': 'SLIP WITH THE KNEES',
  'combo-d08': 'SELL THE FEINT',
  'combo-d09': 'STEP IN TIGHT',
  'combo-d10': 'DRIVE THE KNEE UP',
  // Mastery
  'combo-m01': 'TIMING OVER POWER',
  'combo-m02': 'CHECK RESETS STANCE',
  'combo-m03': 'ATTACK WHAT OPENS',
  'combo-m04': 'COMMIT TO THE RHYTHM',
  'combo-m05': 'COUNTER IMMEDIATELY',
  'combo-m06': 'DRIVE ELBOW DOWN',
  'combo-m07': 'NO WASTED MOVEMENT',
  'combo-m08': 'SELL THE LOW KICK',
  'combo-m09': 'STEP TURN LOOK KICK',
  // Kru pass (2026-10-24)
  'combo-w19': 'SWITCH OFF THE JAB',
  'combo-w20': 'FOOT NEVER LANDS',
  'combo-w21': 'KICK, RESET, TEEP',
  'combo-w22': 'HOOK LOADS THE KNEE',
  'combo-w23': 'JABS OPEN THE BODY',
  'combo-w24': 'HOOK, THEN ELBOW',
  'combo-w25': 'SELL THE JAB',
  'combo-fl09': 'LOW, THEN BODY',
  'combo-fl10': 'LEGS, HANDS, LEGS',
  'combo-fl11': 'JAB, TEEP, SWITCH',
  'combo-fl12': 'LOW, HIGH, LOW',
  'combo-fl13': 'FALL INTO THE KNEE',
  'combo-fl14': 'OUT, THEN IN',
  'combo-fl15': 'ELBOW OVER THE TOP',
  'combo-d11': 'SELL THE SWITCH',
  'combo-d12': 'LONG TO CLOSE',
  'combo-m10': 'HOOK LOADS THE KICK',
  'combo-m11': 'DIP, THEN RISE',
  'combo-m12': 'STEP BACK, THEN KICK',
  // Only his level open (2026-10-25)
  'combo-f11': 'KNEE THROUGH THE BAG',
  'combo-f12': 'JAB, THEN KNEE',
  'combo-f13': 'SHORT AND SHARP',
  'combo-f14': 'STEP IN, ELBOW',
}

/** Sentences that only say where a combo comes from, not how to throw it. */
const SOURCE_NOTE = /^(fagan canon|drill protocol|accuracy drill|form drill)\b/i
/** A sentence opening on one of these describes rather than tells ("The feint drops…"). */
const NOT_IMPERATIVE = /^(the|a|an|this|that|these|it|its|your|two|three|four|five|each|every)\b/i
/** Words a cut-off cue must not end on ("KEEP THE HOOK" not "KEEP THE"). */
const DANGLING = new Set(['a', 'an', 'the', 'to', 'of', 'on', 'in', 'at', 'for', 'with', 'and', 'or', 'but', 'not', 'your', 'from', 'into', 'by', 'is', 'be', 'off'])

/**
 * A cue from a tip alone: the first sentence that tells you to do something
 * (else the first that is not a source note), cut at
 * its first clause break (comma, semicolon, colon, dash, "then"), then to at
 * most four words, dropping a dangling article or preposition at the end.
 * Upper case for the flap. '' when the tip has nothing usable.
 */
export function deriveCue(formTips: string | null | undefined): string {
  const tip = (formTips ?? '').replace(/\s+/g, ' ').trim()
  if (!tip) return ''
  const sentences = tip.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
  const usable = sentences.filter(s => !SOURCE_NOTE.test(s))
  const sentence = usable.find(s => !NOT_IMPERATIVE.test(s)) ?? usable[0] ?? ''
  const clause = sentence
    .split(/\s*(?:[,;:—–]|\s-\s|\bthen\b)\s*/i)[0]
    .replace(/[.!?'"’]+$/g, '')
    .replace(/[^A-Za-z0-9°'’ -]/g, '')
    .trim()
  const words = clause.split(' ').filter(Boolean).slice(0, CUE_MAX_WORDS)
  while (words.length > 1 && (DANGLING.has(words[words.length - 1].toLowerCase()) || words.join(' ').length > CUE_MAX_CHARS)) words.pop()
  const cue = words.join(' ').toUpperCase()
  // One word too long for the flap: no cue rather than a cut-off word.
  return cue.length <= CUE_MAX_CHARS ? cue : ''
}

/** The cue for a combo: the hand-picked one, else one derived from its tip. */
export function comboCue(combo: { id: string; formTips?: string | null } | null | undefined): string {
  if (!combo) return ''
  // the approved Library content (page 60) first, then the hand-cut cues, then one cut from the tip
  return COMBO_CUE_CONTENT[combo.id] ?? COMBO_CUES[combo.id] ?? deriveCue(combo.formTips)
}
