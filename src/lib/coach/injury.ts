// Injury skips and red flags become rules (F16, F17), not AI opinions.
// - A skip with reason "injury" flags its region for 10 days: the next
//   sessions touching it are eased or swapped (back: the back-friendly lifts;
//   other regions: a conservative ease). A neck flag also turns the daily
//   Foundation session into its bad-neck version (lib/foundation).
// - Back red-flag words in skip notes or back notes stop all loading and
//   point to a clinician (F17: saddle numbness, bladder or bowel change,
//   progressive leg weakness, fever, unexplained weight loss, cancer history,
//   major trauma, night pain unrelieved by position; plus the plan's stop
//   line: sharp back pain, or pain or tingling down a leg).
// - Neck red flags do the same (the same F17 stop, region "neck"): arm
//   symptoms (pain, numbness or tingling down an arm, arm or hand weakness),
//   cord signs (clumsy hands, unsteady walking), vascular signs (dizziness,
//   double vision, slurred speech, trouble swallowing, a sudden severe or
//   unusual headache) and neck trauma (a fall, impact or whiplash). Sources:
//   the cervical red-flag consensus framework (IFOMPT) and standard
//   radiculopathy / myelopathy screening.
// Foundation stays on the plan but drops to breathing only on a red flag.
// Pure. Not medical advice: the rule only stops the app loading.

import { DAY_NAMES, RUN_TYPES, dowOf } from './sessions'

export const INJURY_WINDOW_DAYS = 10

const RED_FLAGS: RegExp[] = [
  /saddle/i,
  /numb\w*\s+(?:in\s+)?(?:the\s+)?(?:groin|crotch|genital|between my legs|bum|buttocks?|inner thighs?)/i,
  /bladder|bowel|incontinen|can'?t (?:pee|urinate)|wet myself/i,
  /(?:legs?|foot) (?:\w+ ){0,2}(?:weak|weakness|giving (?:way|out))|weak(?:ness)? in (?:my |the )?(?:legs?|foot)|foot drop/i,
  /fever/i,
  /(?:unexplained|lost) weight|weight loss/i,
  /cancer|tumou?r/i,
  /car (?:crash|accident)|major trauma|fell from/i,
  /night pain|pain at night|wakes? me (?:up )?at night/i,
  // The plan's own stop line: the back turns sharp, or pain or tingling runs
  // down a leg (radicular signs change the picture; see a clinician).
  /sharp (?:\w+ ){0,2}pain|pain (?:is |was |went |turned |got )?sharp|back (?:went|turned|is|feels|got) sharp/i,
  /(?:pain|tingl\w*|numb\w*|pins and needles|burning|shooting|electric)\s+(?:\w+\s+){0,3}(?:down|into|through)\s+(?:my |the |one |both |a )?(?:left |right |back of (?:my |the )?)?(?:legs?|foot|feet|calf|calves|thigh|knee|toes?|buttocks?)/i,
  /sciatica|shooting pain/i,
]

const NECK_RED_FLAGS: RegExp[] = [
  // Arm symptoms (radiculopathy).
  /(?:pain|tingl\w*|numb\w*|pins and needles|burning|shooting|electric)\s+(?:\w+\s+){0,3}(?:down|into|through)\s+(?:my |the |one |both |an? )?(?:left |right )?(?:arms?|forearms?|hands?|fingers?|thumbs?)/i,
  /(?:arms?|hands?) (?:\w+ ){0,2}(?:weak|weakness|giving (?:way|out))|weak(?:ness)? in (?:my |the |one |both )?(?:left |right )?(?:arms?|hands?)|(?:arms?|hands?|fingers) (?:went |go |are |is |feel |feels )?numb|numb (?:left |right )?(?:arms?|hands?|fingers)/i,
  // Cord signs (myelopathy).
  /clumsy (?:hands?|fingers)|(?:hands?|fingers) (?:\w+ ){0,2}clumsy|trouble (?:with )?(?:buttons|writing)|keep dropping things|unsteady (?:walking|on my feet|gait)|walking (?:is |feels )?unsteady|(?:balance|walking) (?:is |feels )?(?:off|wobbly)/i,
  // Vascular signs.
  /dizz\w*|vertigo|double vision|seeing double|slurr\w*|(?:trouble|difficulty|hard|can'?t) swallow\w*|drop attack|face (?:went |is |feels )?numb|facial numbness/i,
  /(?:sudden|severe|worst|thunderclap|unusual)\s+(?:\w+\s+){0,2}head ?aches?/i,
  // Neck trauma: a fall, impact or whiplash.
  /whiplash|\bneck\b(?:\s+\w+){0,6}\s+(?:fall|fell(?! asleep)|impact|crash|takedown|landed|knock(?:ed)?)\b|\b(?:fall|fell(?! asleep)|impact|crash|takedown|landed|knock(?:ed)?)\b(?:\s+\w+){0,6}\s+neck\b/i,
]

export const RED_FLAG_NOTE = 'Back red flag in your notes. Loading stops. See a clinician before training again.'
export const NECK_RED_FLAG_NOTE = 'Neck red flag in your notes. Loading stops. See a clinician before training again.'

/** Which red-flag list a note hits: the back list first, then the neck list. */
export function redFlagRegion(text: string | null | undefined): 'back' | 'neck' | null {
  if (!text) return null
  if (RED_FLAGS.some(r => r.test(text))) return 'back'
  if (NECK_RED_FLAGS.some(r => r.test(text))) return 'neck'
  return null
}

export function hasRedFlag(text: string | null | undefined): boolean {
  return redFlagRegion(text) != null
}

export function hasNeckRedFlag(text: string | null | undefined): boolean {
  return !!text && NECK_RED_FLAGS.some(r => r.test(text))
}

/** Region from the skip sheet's body part or free text. */
export function normaliseRegion(text: string | null | undefined): string | null {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return null
  if (/back|spine|lumbar|disc|sciatic/.test(t)) return 'back'
  if (/knee/.test(t)) return 'knee'
  if (/hip|groin/.test(t)) return 'hip'
  if (/ankle|achilles|foot|heel/.test(t)) return 'ankle'
  if (/shin|calf/.test(t)) return 'shin'
  if (/shoulder/.test(t)) return 'shoulder'
  if (/neck/.test(t)) return 'neck'
  if (/elbow/.test(t)) return 'elbow'
  if (/wrist|hand|finger|knuckle/.test(t)) return 'wrist'
  if (/rib|chest/.test(t)) return 'rib'
  if (/hamstring|quad|thigh|leg/.test(t)) return 'leg'
  return t.trim().slice(0, 30)
}

export interface SkipSignal {
  epochDay: number
  skipReason: string | null
  detail: string | null
  notes: string | null
}

export interface InjuryFlag {
  region: string
  since: number
  redFlag: boolean
  /** One line, house voice. */
  reason: string
}

const REGION_NAME: Record<string, string> = { back: 'Back', knee: 'Knee', hip: 'Hip', ankle: 'Ankle', shin: 'Shin', shoulder: 'Shoulder', neck: 'Neck', elbow: 'Elbow', wrist: 'Wrist', rib: 'Ribs', leg: 'Leg' }

/**
 * The active flag on `day`, from skips and back notes in the last 10 days.
 * A red flag (back or neck list) wins over a region flag.
 */
export function injuryFlag(skips: SkipSignal[], backNotes: Array<{ epochDay: number; text: string | null }>, day: number): InjuryFlag | null {
  const inWindow = <T extends { epochDay: number }>(r: T) => r.epochDay <= day && r.epochDay > day - INJURY_WINDOW_DAYS
  const recentSkips = skips.filter(inWindow).sort((a, b) => b.epochDay - a.epochDay)
  const redSkip = recentSkips.find(s => hasRedFlag(s.detail) || hasRedFlag(s.notes))
  const redNote = redSkip ? null : backNotes.filter(inWindow).find(n => hasRedFlag(n.text))
  if (redSkip || redNote) {
    const since = (redSkip ?? redNote)!.epochDay
    const region = redSkip ? (redFlagRegion(redSkip.detail) ?? redFlagRegion(redSkip.notes)) : redFlagRegion(redNote!.text)
    return region === 'neck'
      ? { region: 'neck', since, redFlag: true, reason: NECK_RED_FLAG_NOTE }
      : { region: 'back', since, redFlag: true, reason: RED_FLAG_NOTE }
  }

  const injury = recentSkips.find(s => s.skipReason === 'injury')
  if (!injury) return null
  const region = normaliseRegion(injury.detail) ?? normaliseRegion(injury.notes) ?? 'unspecified'
  const label = REGION_NAME[region] ?? 'An injury'
  return { region, since: injury.epochDay, redFlag: false, reason: `${label} flagged on ${DAY_NAMES[dowOf(injury.epochDay)]}.` }
}

export type InjuryAction = 'none' | 'stop' | 'back_swap' | 'ease' | 'walk_or_bike' | 'technical'

const LOWER = new Set(['back', 'knee', 'hip', 'ankle', 'shin', 'leg'])

/** What a flag does to one session type. */
export function injuryActionFor(type: string, flag: InjuryFlag | null): { action: InjuryAction; note: string | null } {
  if (!flag) return { action: 'none', note: null }
  if (type === 'mobility' || type === 'active_recovery') return { action: 'none', note: null }
  if (flag.redFlag) return { action: 'stop', note: flag.reason }
  if (type === 'strength') {
    return flag.region === 'back'
      ? { action: 'back_swap', note: `${flag.reason} Back-friendly lifts and one set less today. Stop if it hurts.` }
      : { action: 'ease', note: `${flag.reason} One set less and RPE 6 today. Stop if it hurts.` }
  }
  if (RUN_TYPES.has(type) || type === 'skip_rope') {
    if (flag.region === 'back') return { action: 'walk_or_bike', note: `${flag.reason} Easy walk instead of the run. Walking helps a sore back.` }
    if (LOWER.has(flag.region)) return { action: 'walk_or_bike', note: `${flag.reason} Easy bike instead of the run.` }
    return { action: 'none', note: null }
  }
  if (type === 'bag_work' || type === 'mt_class') {
    return { action: 'technical', note: `${flag.reason} Technique only. No hard rounds.` }
  }
  return { action: 'none', note: null }
}
