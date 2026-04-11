import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ─── Training structure ────────────────────────────────────────

export const trainingBlocks = sqliteTable('training_blocks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  totalWeeks: integer('total_weeks').notNull(),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at').notNull(),
})

export const weekPlans = sqliteTable('week_plans', {
  id: text('id').primaryKey(),
  blockId: text('block_id').notNull().references(() => trainingBlocks.id),
  weekNumber: integer('week_number').notNull(),
  status: text('status').notNull().default('draft'),
  approvedAt: integer('approved_at'),
  notes: text('notes'),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_week_plans_block').on(t.blockId, t.weekNumber),
])

export const runningPlanWeeks = sqliteTable('running_plan_weeks', {
  id: text('id').primaryKey(),
  blockId: text('block_id').notNull().references(() => trainingBlocks.id),
  weekNumber: integer('week_number').notNull(),
  dayOfWeek: integer('day_of_week').notNull(),
  runType: text('run_type').notNull(),
  targetDesc: text('target_desc'),
  targetDurSec: integer('target_dur_sec'),
  targetDistKm: real('target_dist_km'),
}, (t) => [
  index('idx_rpw_block').on(t.blockId, t.weekNumber),
])

// ─── Sessions (hub table) ──────────────────────────────────────

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  weekPlanId: text('week_plan_id').references(() => weekPlans.id),
  scheduledDate: integer('scheduled_date'),
  timeSlot: text('time_slot'),
  status: text('status').notNull().default('planned'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  durationSec: integer('duration_sec'),
  rpe: integer('rpe'),
  difficulty: integer('difficulty'),
  notes: text('notes'),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_sessions_date').on(t.scheduledDate),
  index('idx_sessions_week').on(t.weekPlanId),
  index('idx_sessions_type').on(t.type),
  index('idx_sessions_status').on(t.status, t.scheduledDate),
])

// ─── Strength sessions ─────────────────────────────────────────

export const strengthSessionExercises = sqliteTable('strength_session_exercises', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  exerciseId: text('exercise_id').notNull().references(() => exercises.id),
  orderIndex: integer('order_index').notNull(),
  notes: text('notes'),
}, (t) => [
  index('idx_sse_session').on(t.sessionId),
])

export const strengthSets = sqliteTable('strength_sets', {
  id: text('id').primaryKey(),
  sessionExerciseId: text('session_exercise_id').notNull().references(() => strengthSessionExercises.id),
  setNumber: integer('set_number').notNull(),
  weightKg: real('weight_kg'),
  reps: integer('reps').notNull(),
  isWarmup: integer('is_warmup').notNull().default(0),
  restSec: integer('rest_sec'),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_sets_exercise').on(t.sessionExerciseId),
])

// ─── Bag work sessions ─────────────────────────────────────────

export const bagWorkRounds = sqliteTable('bag_work_rounds', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  roundNumber: integer('round_number').notNull(),
  durationSec: integer('duration_sec').notNull().default(180),
  restSec: integer('rest_sec').notNull().default(60),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_bwr_session').on(t.sessionId),
])

export const bagWorkRoundCombos = sqliteTable('bag_work_round_combos', {
  id: text('id').primaryKey(),
  roundId: text('round_id').notNull().references(() => bagWorkRounds.id),
  comboId: text('combo_id').notNull().references(() => combos.id),
  orderIndex: integer('order_index').notNull(),
}, (t) => [
  index('idx_bwrc_round').on(t.roundId),
])

// ─── Running sessions ──────────────────────────────────────────

export const runSessions = sqliteTable('run_sessions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  planWeek: integer('plan_week'),
  runType: text('run_type'),
  distanceKm: real('distance_km'),
  durationSec: integer('duration_sec'),
  paceSecKm: integer('pace_sec_km'),
  isIndoor: integer('is_indoor').notNull().default(0),
  onePaceArc: text('one_pace_arc'),
  onePaceEp: text('one_pace_ep'),
}, (t) => [
  uniqueIndex('idx_run_session').on(t.sessionId),
])

// ─── Posture corrective sessions ───────────────────────────────

export const postureSessionExercises = sqliteTable('posture_session_exercises', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  exerciseId: text('exercise_id').notNull().references(() => exercises.id),
  orderIndex: integer('order_index').notNull(),
  holdSec: integer('hold_sec'),
  sets: integer('sets').default(1),
  completed: integer('completed').notNull().default(0),
}, (t) => [
  index('idx_pse_session').on(t.sessionId),
])

// ─── Skip rope sessions ────────────────────────────────────────

export const skipRopeSessions = sqliteTable('skip_rope_sessions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  roundCount: integer('round_count').notNull(),
  roundDurSec: integer('round_dur_sec').notNull().default(180),
}, (t) => [
  uniqueIndex('idx_skip_session').on(t.sessionId),
])

// ─── Active recovery sessions ──────────────────────────────────

export const activeRecoverySessions = sqliteTable('active_recovery_sessions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  hipMobility: integer('hip_mobility').notNull().default(0),
  foamRolling: integer('foam_rolling').notNull().default(0),
}, (t) => [
  uniqueIndex('idx_recovery_session').on(t.sessionId),
])

// ─── MT class logs ─────────────────────────────────────────────

export const mtClassLogs = sqliteTable('mt_class_logs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  classType: text('class_type'),
  focusSkill: text('focus_skill'),
  weakness: text('weakness'),
  concept: text('concept'),
  actionItems: text('action_items'),
}, (t) => [
  uniqueIndex('idx_mt_session').on(t.sessionId),
])

// ─── Exercise library (seed data) ──────────────────────────────

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  category: text('category').notNull(),
  muscleGroups: text('muscle_groups'),
  equipment: text('equipment'),
  formCues: text('form_cues'),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_exercises_category').on(t.category),
])

// ─── Combo library (seed data) ─────────────────────────────────

export const combos = sqliteTable('combos', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  tier: text('tier').notNull(),
  level: text('level').notNull(),
  unlocked: integer('unlocked').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_combos_tier').on(t.tier, t.level),
])

// ─── Wellness ──────────────────────────────────────────────────

export const dailyLogs = sqliteTable('daily_logs', {
  id: text('id').primaryKey(),
  logDate: integer('log_date').notNull().unique(),
  sleepHours: real('sleep_hours'),
  weedGrams: real('weed_grams'),
  alcoholScale: integer('alcohol_scale'),
  soreness: integer('soreness'),
  notes: text('notes'),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_daily_log_date').on(t.logDate),
])

export const weeklyJournals = sqliteTable('weekly_journals', {
  id: text('id').primaryKey(),
  weekStart: integer('week_start').notNull().unique(),
  reflection: text('reflection'),
  prompt: text('prompt'),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_journal_week').on(t.weekStart),
])

// ─── Config ────────────────────────────────────────────────────

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey().default('default'),
  mtClassDays: text('mt_class_days'),
  amReminder: text('am_reminder'),
  pmLeadMin: integer('pm_lead_min'),
  onePaceArc: text('one_pace_arc'),
  onePaceEp: text('one_pace_ep'),
  lastDeploy: integer('last_deploy'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const trainingMaxes = sqliteTable('training_maxes', {
  id: text('id').primaryKey(),
  exerciseId: text('exercise_id').notNull().references(() => exercises.id),
  weightKg: real('weight_kg').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [
  uniqueIndex('idx_max_exercise').on(t.exerciseId),
])
