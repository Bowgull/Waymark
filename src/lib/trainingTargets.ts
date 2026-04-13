// ─── Training Volume Targets ────────────────────────────────────
// Defines weekly session targets, priority, and scheduling flexibility.
// These drive the intelligence system: volume accounting, deficit tracking,
// and adaptive suggestions.

export interface SessionTarget {
  type: string
  label: string
  weeklyTarget: number
  priority: 'high' | 'medium' | 'low'
  flexibleTimeSlot: boolean
  defaultTimeSlot: 'am' | 'pm'
  carryForwardWeight: number // 0-1: how much missed volume matters next week
  runCategory?: string
}

export const TRAINING_TARGETS: SessionTarget[] = [
  {
    type: 'strength',
    label: 'Strength',
    weeklyTarget: 2,
    priority: 'high',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.8,
  },
  {
    type: 'foundation_run',
    label: 'Foundation Run',
    weeklyTarget: 3,
    priority: 'medium',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.5,
  },
  {
    type: 'mt_class',
    label: 'MT Class',
    weeklyTarget: 3,
    priority: 'medium',
    flexibleTimeSlot: false,
    defaultTimeSlot: 'pm',
    carryForwardWeight: 0.3, // externally scheduled, less controllable
  },
  {
    type: 'running',
    label: 'Progression Run',
    weeklyTarget: 1,
    priority: 'medium',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.6,
    runCategory: 'progression',
  },
  {
    type: 'bag_work',
    label: 'Bag Work',
    weeklyTarget: 1,
    priority: 'medium',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.4,
  },
  {
    type: 'active_recovery',
    label: 'Reset',
    weeklyTarget: 2,
    priority: 'low',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'pm',
    carryForwardWeight: 0.1, // recovery doesn't "stack", just do it when you can
  },
  {
    type: 'posture_corrective',
    label: 'Foundation',
    weeklyTarget: 0, // built into foundation runs, ad-hoc only
    priority: 'low',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.1,
  },
  {
    type: 'skip_rope',
    label: 'Skip Rope',
    weeklyTarget: 0, // ad-hoc only
    priority: 'low',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.1,
  },
]

/** Get target for a session type (optionally with runCategory for running subtypes) */
export function getTarget(type: string, runCategory?: string): SessionTarget | undefined {
  if (type === 'running' && runCategory) {
    return TRAINING_TARGETS.find(t => t.type === type && t.runCategory === runCategory)
  }
  return TRAINING_TARGETS.find(t => t.type === type && !t.runCategory)
}

/** Get all targets that have a weekly target > 0 (trackable volume) */
export function getTrackableTargets(): SessionTarget[] {
  return TRAINING_TARGETS.filter(t => t.weeklyTarget > 0)
}

/** Get session options for the picker, with timeSlot flexibility info */
export function getPickerOptions(): (SessionTarget & { availableTimeSlots: ('am' | 'pm')[] })[] {
  return TRAINING_TARGETS
    .filter(t => t.type !== 'mt_class') // MT class not available for ad-hoc
    .map(t => ({
      ...t,
      availableTimeSlots: t.flexibleTimeSlot ? ['am', 'pm'] as const : [t.defaultTimeSlot] as const,
    }))
}
