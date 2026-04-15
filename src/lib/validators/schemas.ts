import { z } from 'zod'

export const completeSessionSchema = z.object({
  rpe: z.number().min(1).max(10),
  difficulty: z.number().min(1).max(5),
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
  soreness: z.number().int().min(0).max(10).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

export const adHocSessionSchema = z.object({
  type: z.string().min(1).max(50),
  timeSlot: z.enum(['am', 'pm']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runCategory: z.string().optional(),
})

export const settingsUpdateSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(5000),
})
