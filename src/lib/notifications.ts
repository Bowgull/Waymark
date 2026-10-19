// Waymark notification system
// Morning alarm snooze war + PM leave-by reminder
// Requires @capacitor/local-notifications

import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'
import { heavyHaptic } from './haptics'
import { requestMorningCheckIn } from '@/features/blockZero/checkInTrigger'

const isNative = Capacitor.isNativePlatform()

// ─── Notification IDs ────────────────────────────────────────────────────────
// Reserved ID ranges (keep allocation visible):
//   1000-1059  morning alarm escalating sequence (4 phases, up to 60 pulses)
//   3000       PM leave-by
//   4000-4099  round timer cues
//   5000-5001  redeploy reminders (6-day warn + day-of)
const ALARM_BASE_ID = 1000
const ALARM_MAX_ID = 1059
const ALARM_ALL_IDS = Array.from(
  { length: ALARM_MAX_ID - ALARM_BASE_ID + 1 },
  (_, i) => ALARM_BASE_ID + i,
)
const LEAVE_BY_ID = 3000

// Round timer audio cues — fire as notifications when screen is locked
// so headphone audio still signals the right moment
const CUE_FINISH_WARN = 4001  // last 10s of round
const CUE_ROUND_END   = 4002  // round ends, rest starts
const CUE_REST_WARN   = 4003  // 10s before rest ends
const CUE_REST_END    = 4004  // rest over, go again
const CUE_STRENGTH_REST_END = 4005 // strength set rest over
// Run-walk changes (run / walk), one id per change: 4100..4139.
const CUE_RUN_WALK_BASE = 4100
const CUE_RUN_WALK_MAX = 40
const CUE_RUN_WALK_IDS = Array.from({ length: CUE_RUN_WALK_MAX }, (_, i) => CUE_RUN_WALK_BASE + i)

const REDEPLOY_WARN_ID = 5000
const REDEPLOY_DAY_ID = 5001

// ─── Morning alarm sequence ──────────────────────────────────────────────────
// Silent-mode = haptic-only, so a single buzz disappears. Cadence tightens as
// you stay down; copy escalates in parallel. iOS caps pending notifications
// at 64 — keep the full sequence under 60 to leave room for cues + leave-by.

type AlarmPhase = 'alarm' | 'alarmNuclear'

const GENTLE_COPY = [
  (timeStr: string) => `IT'S ${timeStr}. YOU SAID YOU WANTED THIS.`,
  () => 'UP.',
  () => 'EYES OPEN.',
  () => 'NOW.',
  () => 'MOVE.',
]

const POINTED_COPY = [
  'STILL IN BED. BULLSHIT.',
  "YOU'RE GOING TO SKIP. JUST FUCKING SAY IT.",
  'I SEE YOU.',
  'PHONE IN HAND YET?',
  'THIS IS THE PART WHERE YOU DECIDE.',
  "QUIT PRETENDING YOU CAN'T HEAR ME.",
  'WHO IS THIS FOR, EXACTLY?',
  'THE BAG IS WAITING.',
  'YOUR FUTURE SELF IS WATCHING THIS SHIT.',
  'STOP NEGOTIATING.',
  'MOVE A FUCKING FOOT.',
  'SIT UP. START THERE.',
]

const URGENT_COPY = [
  'LAST NICE ONE. AFTER THIS I GET MEAN.',
  'UP.',
  'NO.',
  'GET THE FUCK UP.',
  'NOW.',
  'ENOUGH.',
  'MOVE.',
  'STOP.',
  'OUT OF BED.',
  'SOFT.',
  'SIT UP.',
  'FEET DOWN.',
  'WATER FIRST.',
  "YOU KNOW WHAT YOU'RE DOING.",
  "I'M NOT FUCKING STOPPING.",
  'COUNT OF THREE.',
  'THREE.',
  'TWO.',
  'ONE.',
  'UP.',
  'I SAID UP.',
  'STILL HERE, ASSHOLE.',
  'GO.',
]

const NUCLEAR_COPY = [
  'GET UP.',
  'STILL FUCKING HERE.',
  'YOU KNOW WHAT YOU ARE RIGHT NOW? SOFT.',
  "THE BAG ISN'T GOING ANYWHERE. NEITHER AM I.",
  'THIS IS EMBARRASSING.',
  "I'VE GOT NOWHERE ELSE TO BE.",
  "YOU'LL FEEL BETTER WHEN IT'S DONE. YOU KNOW THIS.",
  'STILL HERE.',
  'GET. THE FUCK. UP.',
  'EVERY MINUTE YOU LIE THERE, SOMEONE ELSE IS TRAINING.',
  'GET UP.',
  'STILL HERE.',
  'SOFT.',
  'PATHETIC.',
  'GET. UP.',
]

interface AlarmPulse {
  offsetSec: number
  body: string
  actionTypeId: AlarmPhase
}

/**
 * The first pulse with the coach's one quiet line when there is one (page 56:
 * "STRENGTH B IS 2×8 TODAY. TAP TO SEE."). No push on a free Apple account:
 * the line names what was known when the app was last opened. Pure.
 */
export function withCoachLine(body: string, coachLine: string | null | undefined): string {
  if (!coachLine) return body
  const line = coachLine.trim().toUpperCase()
  return `${body} ${/[.!?]$/.test(line) ? line : `${line}.`}`
}

function buildMorningSequence(baseTimeStr: string, coachLine?: string | null): AlarmPulse[] {
  const pulses: AlarmPulse[] = []

  // Phase 1 — gentle (0–60s, every 15s, 5 pulses)
  for (let i = 0; i < 5; i++) {
    const copy = GENTLE_COPY[i]
    pulses.push({
      offsetSec: i * 15,
      body: i === 0 ? withCoachLine(copy(baseTimeStr), coachLine) : copy(baseTimeStr),
      actionTypeId: 'alarm',
    })
  }

  // Phase 2 — pointed (75–185s, every 10s, 12 pulses)
  for (let i = 0; i < POINTED_COPY.length; i++) {
    pulses.push({
      offsetSec: 75 + i * 10,
      body: POINTED_COPY[i],
      actionTypeId: 'alarm',
    })
  }

  // Phase 3 — urgent (195–349s, every 7s, 23 pulses)
  for (let i = 0; i < URGENT_COPY.length; i++) {
    pulses.push({
      offsetSec: 195 + i * 7,
      body: URGENT_COPY[i],
      actionTypeId: 'alarmNuclear',
    })
  }

  // Phase 4 — nuclear (365–575s, every 15s, 15 pulses)
  for (let i = 0; i < NUCLEAR_COPY.length; i++) {
    pulses.push({
      offsetSec: 365 + i * 15,
      body: NUCLEAR_COPY[i],
      actionTypeId: 'alarmNuclear',
    })
  }

  return pulses
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(':').map(Number)
  return { hour: h, minute: m }
}

function nextOccurrence(hour: number, minute: number): Date {
  const now = new Date()
  const candidate = new Date()
  candidate.setHours(hour, minute, 0, 0)
  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1)
  }
  return candidate
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function formatTime12(date: Date): string {
  let h = date.getHours()
  const m = date.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative) return false
  const { display } = await LocalNotifications.checkPermissions()
  if (display === 'granted') return true
  const { display: result } = await LocalNotifications.requestPermissions()
  return result === 'granted'
}

// Legacy IDs from pre-2026-04-23 nuclear range (2000-2019). Kept here so a
// one-time cleanup can cancel any orphaned pulses still pending from the old
// schedule after upgrade. Remove once this build has been in prod a few weeks.
const LEGACY_NUCLEAR_IDS = Array.from({ length: 20 }, (_, i) => 2000 + i)

export async function cancelAllAlarms(): Promise<void> {
  if (!isNative) return
  await LocalNotifications.cancel({
    notifications: [...ALARM_ALL_IDS, ...LEGACY_NUCLEAR_IDS].map((id) => ({ id })),
  })
}

export interface ScheduleAlarmsResult {
  scheduled: boolean
  baseAt?: Date  // when the morning alarm will next fire
  reason?: 'not-native' | 'no-permission'
}

export async function scheduleAlarms(
  amReminder: string,
  pmSessionTime: string,
  pmLeadMin: number,
  options: { amEnabled?: boolean; pmEnabled?: boolean; coachLine?: string | null } = {},
): Promise<ScheduleAlarmsResult> {
  if (!isNative) return { scheduled: false, reason: 'not-native' }
  const permitted = await requestNotificationPermission()
  if (!permitted) return { scheduled: false, reason: 'no-permission' }

  const amEnabled = options.amEnabled !== false
  const pmEnabled = options.pmEnabled !== false

  await cancelAllAlarms()
  await LocalNotifications.cancel({ notifications: [{ id: LEAVE_BY_ID }] })

  // ── Morning alarm sequence ────────────────────────────────────────────────
  const { hour: amH, minute: amM } = parseTime(amReminder)
  const base = nextOccurrence(amH, amM)

  if (amEnabled) {
    const pulses = buildMorningSequence(formatTime12(base), options.coachLine)
    if (pulses.length > ALARM_ALL_IDS.length) {
      throw new Error(
        `Morning alarm sequence has ${pulses.length} pulses but only ${ALARM_ALL_IDS.length} ID slots reserved`,
      )
    }
    const morningSound = { sound: 'morning.caf', interruptionLevel: 'timeSensitive' as const }
    const nuclearSound = { sound: 'nuclear.caf', interruptionLevel: 'timeSensitive' as const }

    await LocalNotifications.schedule({
      notifications: pulses.map((pulse, i) => ({
        id: ALARM_BASE_ID + i,
        title: 'Waymark',
        body: pulse.body,
        schedule: { at: new Date(base.getTime() + pulse.offsetSec * 1000) },
        actionTypeId: pulse.actionTypeId,
        extra: { type: pulse.actionTypeId },
        ...(pulse.actionTypeId === 'alarmNuclear' ? nuclearSound : morningSound),
      })),
    })
  }

  // ── PM leave-by reminder ──────────────────────────────────────────────────
  if (pmEnabled) {
    const { hour: pmH, minute: pmM } = parseTime(pmSessionTime)
    const pmBase = nextOccurrence(pmH, pmM)
    const leaveAt = addMinutes(pmBase, -pmLeadMin)

    if (leaveAt > new Date()) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: LEAVE_BY_ID,
            title: 'Waymark',
            body: `Leave by ${formatTime12(leaveAt)} or you're that guy who walks in late.`,
            schedule: { at: leaveAt },
            extra: { type: 'leaveBy' },
          },
        ],
      })
    }
  }

  // If AM is disabled we can't verify via ALARM_BASE_ID — treat as scheduled.
  if (!amEnabled) return { scheduled: true, baseAt: base }

  // Verify iOS actually queued the morning alarm before we tell the user it's set.
  try {
    const pending = await LocalNotifications.getPending()
    const armed = pending.notifications.some((n) => Number(n.id) === ALARM_BASE_ID)
    if (!armed) return { scheduled: false, reason: 'no-permission' }
  } catch {
    // getPending unsupported or failed — best-effort, treat as scheduled
  }

  return { scheduled: true, baseAt: base }
}

// Boot-time sync: rehydrate scheduled alarms from the user's saved settings.
// Without this, `scheduleAlarms()` only ran on Settings save — so fresh installs
// or reinstalls (sideload cert regen) had no OS-level alarms until the user
// re-opened Settings and hit Save. Call once at app boot after permission prompt.
export async function syncAlarmsFromSettings(settings: {
  amReminder?: string | null
  pmSessionTime?: string | null
  pmLeadMin?: number | null
  amEnabled?: number | null
  pmEnabled?: number | null
}, coachLine?: string | null): Promise<void> {
  if (!isNative) return
  const { amReminder, pmSessionTime, pmLeadMin } = settings
  if (!amReminder || !pmSessionTime || pmLeadMin == null) return
  await scheduleAlarms(amReminder, pmSessionTime, pmLeadMin, {
    amEnabled: settings.amEnabled !== 0,
    pmEnabled: settings.pmEnabled !== 0,
    coachLine,
  })
}

// Called when app comes to foreground — Option C kill switch
// If it's within 30 minutes after the alarm was supposed to fire, you're up. Cancel everything.
export async function handleForegroundAlarmCheck(amReminder: string): Promise<void> {
  if (!isNative) return
  const { hour, minute } = parseTime(amReminder)
  const now = new Date()
  const alarmToday = new Date()
  alarmToday.setHours(hour, minute, 0, 0)

  const diffMin = (now.getTime() - alarmToday.getTime()) / 60000

  if (diffMin >= 0 && diffMin <= 30) {
    await cancelAllAlarms()
  }
}

// ─── Redeploy reminders ──────────────────────────────────────────────────────
// Sideload cert lives 7 days. Fire a silent heads-up the day before
// and another the morning it dies. No sound — must respect silent mode.

export async function cancelRedeployReminders(): Promise<void> {
  if (!isNative) return
  await LocalNotifications.cancel({
    notifications: [{ id: REDEPLOY_WARN_ID }, { id: REDEPLOY_DAY_ID }],
  })
}

export async function scheduleRedeployReminders(buildTime: number): Promise<void> {
  if (!isNative) return
  const permitted = await requestNotificationPermission()
  if (!permitted) return

  const warnAt = new Date(buildTime + 6 * 86400000)
  const dayAt = new Date(buildTime + 7 * 86400000)
  const now = new Date()

  const notifications = []
  if (warnAt > now) {
    notifications.push({
      id: REDEPLOY_WARN_ID,
      title: 'Waymark',
      body: 'Redeploy tomorrow or the app goes dark.',
      schedule: { at: warnAt },
      sound: undefined,
      extra: { type: 'redeploy' },
    })
  }
  if (dayAt > now) {
    notifications.push({
      id: REDEPLOY_DAY_ID,
      title: 'Waymark',
      body: 'Redeploy today. Connect cable.',
      schedule: { at: dayAt },
      sound: undefined,
      extra: { type: 'redeploy' },
    })
  }

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications })
  }
}

// ─── Round cue notifications ─────────────────────────────────────────────────
// These fire via the OS when the screen is locked so headphone audio
// still signals the right training moment.
//
// Every cue is scheduled at an absolute wall-clock time (the timer's stored
// end), so a cue scheduled after a resume lands on the real end, not on
// "now + duration". All cues are `silent`: with the app in the foreground the
// plugin then shows nothing and plays nothing (the app plays its own cue), so
// a cue no longer plays twice with the app open. In the background the OS
// presents them as usual, sound included.

const CUE_IDS = new Set([CUE_FINISH_WARN, CUE_ROUND_END, CUE_REST_WARN, CUE_REST_END, CUE_STRENGTH_REST_END, ...CUE_RUN_WALK_IDS])

export function isCueNotificationId(id: number): boolean {
  return CUE_IDS.has(id)
}

interface CueSpec {
  id: number
  body: string
  sound: string
  at: Date
}

function cue(spec: CueSpec) {
  return {
    id: spec.id,
    title: 'Waymark',
    body: spec.body,
    schedule: { at: spec.at },
    sound: spec.sound,
    silent: true,
    interruptionLevel: 'timeSensitive' as const,
  }
}

/** The round's cues (finish warning, round end) ending at `roundEndsAtMs`. */
export function roundCueSpecs(roundEndsAtMs: number, nowMs: number): CueSpec[] {
  const out: CueSpec[] = []
  const finishAt = roundEndsAtMs - 10_000
  if (finishAt > nowMs) out.push({ id: CUE_FINISH_WARN, body: 'Finish.', sound: 'finish_warning.caf', at: new Date(finishAt) })
  if (roundEndsAtMs > nowMs) out.push({ id: CUE_ROUND_END, body: 'Rest.', sound: 'round_end.caf', at: new Date(roundEndsAtMs) })
  return out
}

/** The rest's cues (get ready, go) ending at `restEndsAtMs`. */
export function restCueSpecs(restEndsAtMs: number, nowMs: number): CueSpec[] {
  const out: CueSpec[] = []
  const warnAt = restEndsAtMs - 10_000
  if (warnAt > nowMs) out.push({ id: CUE_REST_WARN, body: 'Get ready.', sound: 'rest_warning.caf', at: new Date(warnAt) })
  if (restEndsAtMs > nowMs) out.push({ id: CUE_REST_END, body: 'Go.', sound: 'round_start.caf', at: new Date(restEndsAtMs) })
  return out
}

async function scheduleCues(specs: CueSpec[]): Promise<void> {
  if (!isNative || specs.length === 0) return
  try {
    await LocalNotifications.schedule({ notifications: specs.map(cue) })
  } catch (err) {
    console.warn('[notifications] cue schedule failed', err)
  }
}

/**
 * Schedule a round and, when there is one, the rest after it in one go. JS is
 * suspended while the screen is locked, so the rest's "Get ready." and "Go."
 * must already be scheduled when the round starts.
 */
export async function scheduleRoundCuesUntil(roundEndsAtMs: number, restSec: number | null): Promise<void> {
  if (!isNative) return
  const now = Date.now()
  await cancelRoundActiveCues()
  await cancelRestCues()
  const specs = roundCueSpecs(roundEndsAtMs, now)
  if (restSec != null && restSec > 0) specs.push(...restCueSpecs(roundEndsAtMs + restSec * 1000, now))
  await scheduleCues(specs)
}

/** Schedule the rest cues for a rest that ends at `restEndsAtMs`. */
export async function scheduleRestCuesUntil(restEndsAtMs: number): Promise<void> {
  if (!isNative) return
  await cancelRestCues()
  await scheduleCues(restCueSpecs(restEndsAtMs, Date.now()))
}

// Schedule cues for an active round (finish warning + round end).
// Call when a round starts. durationSec is the round length.
export async function scheduleRoundActiveCues(durationSec: number): Promise<void> {
  if (!isNative) return
  await scheduleCues(roundCueSpecs(Date.now() + durationSec * 1000, Date.now()))
}

// Cancel round active cues (finish warning + round end).
// Call when a round ends — naturally or early — before scheduling rest cues.
export async function cancelRoundActiveCues(): Promise<void> {
  if (!isNative) return
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: CUE_FINISH_WARN }, { id: CUE_ROUND_END }],
    })
  } catch {
    // nothing pending
  }
}

// Schedule cues for the rest period (rest warning + rest end).
// Call when rest starts. restSec is the rest duration.
export async function scheduleRestCues(restSec: number): Promise<void> {
  if (!isNative) return
  await scheduleRestCuesUntil(Date.now() + restSec * 1000)
}

// Cancel rest cues. Call when rest ends or is skipped.
export async function cancelRestCues(): Promise<void> {
  if (!isNative) return
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: CUE_REST_WARN }, { id: CUE_REST_END }],
    })
  } catch {
    // nothing pending
  }
}

/** Cancel every timer cue (leaving a session, or before a resume re-sync). */
export async function cancelAllCues(): Promise<void> {
  if (!isNative) return
  try {
    await LocalNotifications.cancel({ notifications: [...CUE_IDS].map(id => ({ id })) })
  } catch {
    // nothing pending
  }
}

// Single cue for strength set rest — fires at the precise wall-clock ms when rest ends.
export async function scheduleStrengthRestEnd(endsAtMs: number): Promise<void> {
  if (!isNative) return
  if (endsAtMs <= Date.now()) return
  await scheduleCues([{ id: CUE_STRENGTH_REST_END, body: 'Next set.', sound: 'round_start.caf', at: new Date(endsAtMs) }])
}

export async function cancelStrengthRestEnd(): Promise<void> {
  if (!isNative) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: CUE_STRENGTH_REST_END }] })
  } catch {
    // nothing pending
  }
}

/**
 * The run-walk's changes as cues ("Run." / "Walk."), each at its wall-clock
 * time from the run's (virtual) start. All scheduled at once: JS is suspended
 * while the screen is locked. Call again after a pause/resume with the new start.
 */
export function runWalkCueSpecs(startedAtMs: number, cues: Array<{ atSec: number; kind: 'warmup' | 'run' | 'walk' }>, nowMs: number): CueSpec[] {
  return cues
    .slice(0, CUE_RUN_WALK_MAX)
    .map((c, i) => ({
      id: CUE_RUN_WALK_BASE + i,
      body: c.kind === 'run' ? 'Run.' : 'Walk.',
      sound: c.kind === 'run' ? 'round_start.caf' : 'round_end.caf',
      at: new Date(startedAtMs + c.atSec * 1000),
    }))
    .filter(s => s.at.getTime() > nowMs)
}

export async function scheduleRunWalkCues(startedAtMs: number, cues: Array<{ atSec: number; kind: 'warmup' | 'run' | 'walk' }>): Promise<void> {
  if (!isNative) return
  await cancelRunWalkCues()
  await scheduleCues(runWalkCueSpecs(startedAtMs, cues, Date.now()))
}

export async function cancelRunWalkCues(): Promise<void> {
  if (!isNative) return
  try {
    await LocalNotifications.cancel({ notifications: CUE_RUN_WALK_IDS.map(id => ({ id })) })
  } catch {
    // nothing pending
  }
}

// Register action types + listen for "I'm Up" taps
// Call once on app startup
export async function initNotificationListeners(): Promise<void> {
  if (!isNative) return

  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: 'alarm',
        actions: [
          { id: 'iAmUp', title: "I'm Up", foreground: true },
          { id: 'snooze', title: 'Snooze' },
        ],
      },
      {
        id: 'alarmNuclear',
        actions: [
          { id: 'iAmUp', title: "I'm Up", foreground: true },
        ],
      },
    ],
  })

  LocalNotifications.addListener('localNotificationReceived', (notification) => {
    // Timer cues arrive here only in the foreground, where the session
    // already played its own cue and haptic. Buzzing again doubled it.
    if (isCueNotificationId(notification.id)) return
    heavyHaptic()
  })

  LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
    if (event.actionId === 'iAmUp') {
      await cancelAllAlarms()
      // I'M UP opens the morning check-in cards (design-decisions.md).
      requestMorningCheckIn()
    }
    // 'snooze' tapped — next notification is already scheduled, nothing extra needed
  })
}
