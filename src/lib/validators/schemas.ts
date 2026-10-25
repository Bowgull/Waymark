import { z } from 'zod'

export const completeSessionSchema = z.object({
  rpe: z.number().min(1).max(10),
  // Difficulty is deprecated (redundant with rpe/Effort). Kept optional so
  // legacy clients don't break; new clients omit it. DB column preserved for
  // historical data.
  difficulty: z.number().min(1).max(5).optional(),
  notes: z.string().max(1000).default(''),
  // When the athlete tapped finish (unix seconds). An outbox replay can land
  // hours later; the server keeps it between the start and now.
  completedAt: z.number().int().min(0).optional(),
  // Bag work and rope: seconds actually worked in each round, in order (the done summary's per-round lines).
  roundSecs: z.array(z.number().int().min(0).max(3600)).max(40).optional(),
  // Ended early (bag work, rope): the one-tap reason. "no_time" holds the next dose; it never reads as too hard.
  endReason: z.enum(['no_time', 'rough', 'pain', 'other']).nullable().optional(),
  // Bag work's finisher (page 86): each set done or skipped, with its goal and time; checked again by parseFinisherLog.
  finisherLog: z.object({
    readiness: z.enum(['low', 'ok', 'high']),
    ended: z.boolean(),
    sets: z.array(z.object({ key: z.string().max(24), name: z.string().max(24), goal: z.number().int(), sec: z.number().int(), status: z.enum(['done', 'skipped']).nullable() })).min(1).max(6),
    at: z.number().int().min(0).optional(),
  }).optional(),
})

export const strengthSetSchema = z.object({
  weightKg: z.number().min(0).max(500).optional(),
  reps: z.number().int().min(0).max(100).optional(),
  rpe: z.number().min(1).max(10).optional(),
  completed: z.boolean().optional(),
})

export const dailyLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sleepHours: z.number().min(0).max(24).optional().nullable(),
  // Legacy grams: still accepted from an old build's queued check-in, never sent now.
  weedGrams: z.number().min(0).max(100).optional().nullable(),
  // Herb on the check-in's 0-9 scale: 0 = none, 9 = most.
  herbScale: z.number().int().min(0).max(9).optional().nullable(),
  alcoholScale: z.number().int().min(0).max(10).optional().nullable(),
  // The Today gauge sends 1-5 (Fresh .. Cooked); prompts read it as /5.
  soreness: z.number().int().min(1).max(5).optional().nullable(),
  // Detailed check-in (Block Zero readiness). 1-5; stress is the only one where higher is worse.
  sleepQuality: z.number().int().min(1).max(5).optional().nullable(),
  energy: z.number().int().min(1).max(5).optional().nullable(),
  stress: z.number().int().min(1).max(5).optional().nullable(),
  mood: z.number().int().min(1).max(5).optional().nullable(),
  backToday: z.number().int().min(1).max(5).optional().nullable(),
  backNotes: z.string().max(500).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  // "<Place> today" while a place is on watch (page 58 / 57): { knee: 2 }, 1 bad .. 5 fine; null clears one.
  regionRatings: z.record(z.string().max(20), z.number().int().min(1).max(5).nullable()).optional().nullable(),
  // A check-in card answered on the way (the deck saves as it goes): written, but the coach's
  // check-in rules and the replan wait for the full save.
  partial: z.boolean().optional(),
})

// PATCH /api/strength-sets/:id. reps also carries seconds for timed holds.
export const strengthSetPatchSchema = z.object({
  weightKg: z.number().min(0).max(1000).optional().nullable(),
  reps: z.number().int().min(0).max(1000).optional(),
  completedAt: z.number().int().min(0).optional(),
  loadFeedback: z.string().max(50).optional().nullable(),
  // Reps in reserve: 0, 1, 2 or 3 (3 = "3 or more").
  rir: z.number().int().min(0, 'rir is 0-3 (3 = 3 or more)').max(3, 'rir is 0-3 (3 = 3 or more)').optional().nullable(),
})

// PATCH /api/mt-class-logs/:id. classType takes the Block Zero names
// (technique, pads, bag, clinch, sparring) and the log screen's (technical,
// padwork, general).
export const MT_CLASS_TYPES = ['technique', 'pads', 'bag', 'clinch', 'sparring', 'technical', 'padwork', 'general'] as const
export const mtClassLogPatchSchema = z.object({
  classType: z.enum(MT_CLASS_TYPES).optional(),
  durationMin: z.number().int().min(1).max(300).optional().nullable(),
  focusSkill: z.string().max(1000).optional(),
  weakness: z.string().max(1000).optional(),
  concept: z.string().max(1000).optional(),
  actionItems: z.string().max(2000).optional(),
  learnedNote: z.string().max(4000).optional(),
})

// POST /api/blocks/:id/tests: one result, an array, or { results: [...] }.
const blockTestSchema = z.object({
  week: z.number().int(),
  testKey: z.string().min(1).max(80),
  value: z.number(),
  unit: z.string().max(10).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
})
export const blockTestsBodySchema = z.union([
  blockTestSchema.transform(r => [r]),
  z.array(blockTestSchema).min(1).max(50),
  z.object({ results: z.array(blockTestSchema).min(1).max(50) }).transform(b => b.results),
])

export const adHocSessionSchema = z.object({
  type: z.string().min(1).max(50),
  timeSlot: z.enum(['am', 'pm']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runCategory: z.string().optional(),
  label: z.string().max(80).optional(),
  /** The athlete's local today (YYYY-MM-DD). Past days are refused against it. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Bag Work (page 80): COACH / HYBRID / CUSTOM and his rounds (lib/coach/bagArc parseBagSpec checks it). */
  bag: z.unknown().optional(),
})

export const settingsUpdateSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(5000),
})

// PATCH /api/user-profile: the fields the coach reads that Settings edits.
// Birth date gives the max-HR estimate (Tanaka) until real runs refine it;
// injuries is the free-text back / pain status the onboarding asked for.
export const userProfilePatchSchema = z.object({
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dob is YYYY-MM-DD').refine(v => {
    const d = new Date(`${v}T12:00:00Z`)
    if (Number.isNaN(d.getTime())) return false
    const year = d.getUTCFullYear()
    return year >= 1920 && d.getTime() < Date.now()
  }, 'dob must be a real past date').optional().nullable(),
  maxHr: z.number().int().min(120, 'maxHr is 120-230').max(230, 'maxHr is 120-230').optional().nullable(),
  injuries: z.string().max(1000).optional().nullable(),
}).refine(b => b.dob !== undefined || b.maxHr !== undefined || b.injuries !== undefined, 'Nothing to update.')
