import { z } from 'zod'

export const completeSessionSchema = z.object({
  rpe: z.number().min(1).max(10),
  // Difficulty is deprecated (redundant with rpe/Effort). Kept optional so
  // legacy clients don't break; new clients omit it. DB column preserved for
  // historical data.
  difficulty: z.number().min(1).max(5).optional(),
  notes: z.string().max(1000).default(''),
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
  weedGrams: z.number().min(0).max(100).optional().nullable(),
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
})

export const settingsUpdateSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(5000),
})
