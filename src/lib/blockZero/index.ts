// Block Zero rules engine. Plain typed functions, no DB, no fetch. Each file
// cites the evidence rule (R1-R16) it implements. The app reads limits from
// here; the AI only chooses inside them.

export {
  BLOCK_ZERO_BASE_WEEKS,
  BLOCK_ZERO_EXTENSION_WEEK,
  BLOCK_ZERO_MAX_EXTENSIONS,
  BLOCK_ZERO_MAX_WEEKS,
  blockZeroPhase,
  blockZeroTrainingWeek,
  extensionsUsed,
  type BlockZeroPhase,
} from './weeks'

export {
  STRENGTH_DAY_BY_DOW,
  getBlockZeroWeekTemplate,
  strengthBeforeRunning,
  strengthDayFor,
  type BlockZeroTemplateSession,
  type StrengthDay,
} from './weekPlan'

export {
  BACK_FRIENDLY_SWAPS,
  BACK_FRIENDLY_THRESHOLD,
  STRENGTH_WEEK_TARGETS,
  backFriendlyVariation,
  blockZeroWorkingLoad,
  defaultMainLift,
  effectiveRir,
  getStrengthWeekTarget,
  mainLiftHardSets,
  latestRirTopSet,
  liftRegion,
  nextLoad,
  RIR_MAX,
  RIR_THREE_PLUS_AS,
  type LiftRegion,
  type LoggedWorkingSet,
  type LoadTarget,
  type MainLiftSlot,
  type NextLoad,
  type StrengthWeekTarget,
  type TopSet,
  type VariationChoice,
  type WorkingLoad,
} from './strength'

export { E1RM_MAX_REPS, brzycki, e1rmFromRir, e1rmFromRpe, epley, rirFromRpe } from './e1rm'

export {
  RESTART_SESSION_SEC,
  RESTART_WEEKLY_SEC,
  RUN_WALK_WEEKS,
  SINGLE_RUN_CAP_RATIO,
  WEEKLY_RUN_CAP_RATIO,
  ageFromDob,
  getRunWalkWeek,
  hrCeiling,
  prescribeRunWalk,
  runWalkTotalSec,
  singleRunCap,
  tanakaMaxHr,
  weeklyRunCap,
  type RunWalkPrescription,
  type RunWalkWeek,
  type WeeklyRunContext,
} from './running'

export { WEEKLY_LOAD_SOFT_CAP, sessionLoad, weekOverWeekChange, weeklyLoadFlag, weeklyLoadTotals, type LoadEntry, type LoadFlag } from './load'

export { evaluateReadiness, latestReadiness, READINESS_ITEMS, type CheckIn, type ReadinessDay, type ReadinessItem, type ReadinessVerdict } from './readiness'

export { EASED_RPE_CEILING, easeSession, type EaseTriggers, type EasedSession, type PlannedSession } from './autoEase'

export {
  allowedClassTypes,
  evaluateClassRequest,
  mtRampWeek,
  normaliseClassType,
  rebalanceDayForClass,
  weeklyClassCap,
  type ClassDecision,
  type MtClassType,
} from './muayThai'

export {
  FIGHTER_DEFAULT_TOTAL_WEEKS,
  KEY_SESSION_TYPES,
  MIN_COMPLETION_RATE,
  NEXT_BLOCK_NAME,
  RECENT_GAP_WINDOW_DAYS,
  backTrend,
  evaluateEndGate,
  keySessionCompletionRate,
  longestGapInWindow,
  planTransition,
  retestE1rms,
  type BackTrend,
  type EndGateInput,
  type EndGateResult,
  type TransitionPlan,
} from './endGate'

export { FIGHTER_MAIN_LIFT_IDS, isFighterMainLift, resolveCalibrationStarts, resolveLiftId, selectMainLifts } from './lifts'

export { checkInFromDailyLog, readinessReport, rollingLoadRead, type DailyLogFields, type LoadRead, type ReadinessItemRead, type ReadinessReport } from './checkIn'

export {
  CHECK_SET_MAX_PLANNED_REPS,
  FIXED_TEST_KEYS,
  MOBILITY_AREAS,
  checkSetE1rm,
  e1rmTestKey,
  e1rmsFromTests,
  isTestWeek,
  parseTestKey,
  validateTestResult,
  type LoggedCheckSet,
  type TestResultInput,
  type TestUnit,
} from './tests'

export {
  calibrationCeilingKg,
  fixedResults,
  hasWeek1Tests,
  retestCeilingKg,
  testDeltas,
  week1LiftBaselines,
  workupE1rm,
  type FixedResult,
  type LiftBaseline,
  type TestDelta,
  type TestRow,
  type WorkupSet,
} from './testData'

export {
  DURATION_BOUNDS,
  GUARDRAIL_TAG,
  HARD_TYPES,
  capLoad,
  checkPlacement,
  clampsForStorage,
  classTypeFromLabel,
  guardCalibrationStarts,
  guardCalibrationWrites,
  guardLoadProposals,
  guardMtCap,
  guardReactiveReplan,
  guardReplaceSuggestions,
  guardWeekPlan,
  houseVoice,
  isBlockZeroRestDay,
  logClamps,
  safeReplaceOptions,
  type BlockZeroGuardContext,
  type Clamp,
  type ClampCode,
  type GuardSession,
  type Guarded,
  type ReplacedSession,
  type RunHistory,
} from './guardrails'

export { estimateTokens, runCapsMin, serializeBlockZeroContext, type AiContextLift, type BlockZeroAiContextInput } from './aiContext'
