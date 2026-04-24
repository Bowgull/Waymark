// Waymark notification system
// Morning alarm snooze war + PM leave-by reminder
// Requires @capacitor/local-notifications

import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'
import { heavyHaptic } from './haptics'

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

function buildMorningSequence(baseTimeStr: string): AlarmPulse[] {
  const pulses: AlarmPulse[] = []

  // Phase 1 — gentle (0–60s, every 15s, 5 pulses)
  for (let i = 0; i < 5; i++) {
    const copy = GENTLE_COPY[i]
    pulses.push({
      offsetSec: i * 15,
      body: copy(baseTimeStr),
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
  options: { amEnabled?: boolean; pmEnabled?: boolean } = {},
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
    const pulses = buildMorningSequence(formatTime12(base))
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
}): Promise<void> {
  if (!isNative) return
  const { amReminder, pmSessionTime, pmLeadMin } = settings
  if (!amReminder || !pmSessionTime || pmLeadMin == null) return
  await scheduleAlarms(amReminder, pmSessionTime, pmLeadMin, {
    amEnabled: settings.amEnabled !== 0,
    pmEnabled: settings.pmEnabled !== 0,
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

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000)
}

// Schedule cues for an active round (finish warning + round end).
// Call when a round starts. durationSec is the round length.
export async function scheduleRoundActiveCues(durationSec: number): Promise<void> {
  if (!isNative) return
  const now = new Date()
  const notifications = []

  const finishAt = addSeconds(now, durationSec - 10)
  const roundEndAt = addSeconds(now, durationSec)

  if (durationSec > 10 && finishAt > now) {
    notifications.push({
      id: CUE_FINISH_WARN,
      title: 'Waymark',
      body: 'Finish.',
      schedule: { at: finishAt },
      sound: 'finish_warning.caf',
      interruptionLevel: 'timeSensitive' as const,
    })
  }
  notifications.push({
    id: CUE_ROUND_END,
    title: 'Waymark',
    body: 'Rest.',
    schedule: { at: roundEndAt },
    sound: 'round_end.caf',
    interruptionLevel: 'timeSensitive' as const,
  })

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications })
  }
}

// Cancel round active cues (finish warning + round end).
// Call when a round ends — naturally or early — before scheduling rest cues.
export async function cancelRoundActiveCues(): Promise<void> {
  if (!isNative) return
  await LocalNotifications.cancel({
    notifications: [{ id: CUE_FINISH_WARN }, { id: CUE_ROUND_END }],
  })
}

// Schedule cues for the rest period (rest warning + rest end).
// Call when rest starts. restSec is the rest duration.
export async function scheduleRestCues(restSec: number): Promise<void> {
  if (!isNative) return
  const now = new Date()
  const notifications = []

  const restWarnAt = addSeconds(now, restSec - 10)
  const restEndAt = addSeconds(now, restSec)

  if (restSec > 10 && restWarnAt > now) {
    notifications.push({
      id: CUE_REST_WARN,
      title: 'Waymark',
      body: 'Get ready.',
      schedule: { at: restWarnAt },
      sound: 'rest_warning.caf',
      interruptionLevel: 'timeSensitive' as const,
    })
  }
  notifications.push({
    id: CUE_REST_END,
    title: 'Waymark',
    body: 'Go.',
    schedule: { at: restEndAt },
    sound: 'round_start.caf',
    interruptionLevel: 'timeSensitive' as const,
  })

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications })
  }
}

// Cancel rest cues. Call when rest ends or is skipped.
export async function cancelRestCues(): Promise<void> {
  if (!isNative) return
  await LocalNotifications.cancel({
    notifications: [{ id: CUE_REST_WARN }, { id: CUE_REST_END }],
  })
}

// Single cue for strength set rest — fires at the precise wall-clock ms when rest ends.
export async function scheduleStrengthRestEnd(endsAtMs: number): Promise<void> {
  if (!isNative) return
  await LocalNotifications.schedule({
    notifications: [{
      id: CUE_STRENGTH_REST_END,
      title: 'Waymark',
      body: 'Next set.',
      schedule: { at: new Date(endsAtMs) },
      sound: 'round_start.caf',
      interruptionLevel: 'timeSensitive' as const,
    }],
  })
}

export async function cancelStrengthRestEnd(): Promise<void> {
  if (!isNative) return
  await LocalNotifications.cancel({ notifications: [{ id: CUE_STRENGTH_REST_END }] })
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

  LocalNotifications.addListener('localNotificationReceived', () => {
    heavyHaptic()
  })

  LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
    if (event.actionId === 'iAmUp') {
      await cancelAllAlarms()
    }
    // 'snooze' tapped — next notification is already scheduled, nothing extra needed
  })
}
