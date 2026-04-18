// Waymark notification system
// Morning alarm snooze war + PM leave-by reminder
// Requires @capacitor/local-notifications

import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'

const isNative = Capacitor.isNativePlatform()

// ─── Notification IDs ────────────────────────────────────────────────────────
// Reserved ID ranges (keep allocation visible):
//   1000-1012  morning alarm base + snoozes
//   2000-2047  nuclear follow-ups
//   3000       PM leave-by
//   4000-4099  round timer cues
//   5000-5001  redeploy reminders (6-day warn + day-of)
const ALARM_BASE_ID = 1000
const ALARM_SNOOZE_1_ID = 1001
const ALARM_SNOOZE_2_ID = 1002
const ALARM_SNOOZE_3_ID = 1003
const NUCLEAR_IDS = Array.from({ length: 20 }, (_, i) => 2000 + i)
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

const ALL_ALARM_IDS = [
  ALARM_BASE_ID,
  ALARM_SNOOZE_1_ID,
  ALARM_SNOOZE_2_ID,
  ALARM_SNOOZE_3_ID,
  ...NUCLEAR_IDS,
]

// ─── Copy ─────────────────────────────────────────────────────────────────────
// Voice: you talking to yourself. Dark. Direct. No fluff.

const NUCLEAR_COPY = [
  'Get up.',
  'Still here.',
  'You know what you are right now? Soft.',
  "The bag isn't going anywhere. Neither am I.",
  'This is embarrassing.',
  "I've got nowhere else to be.",
  "You'll feel better when you're done. You won't feel better lying there.",
  'Still here.',
  'Get. Up.',
  'Every minute you stay in bed is a minute someone else is training.',
  'Get up.',
  'Still here.',
  'You know what you are right now? Soft.',
  "The bag isn't going anywhere. Neither am I.",
  'This is embarrassing.',
  "I've got nowhere else to be.",
  "You'll feel better when you're done. You won't feel better lying there.",
  'Still here.',
  'Get. Up.',
  'Every minute you stay in bed is a minute someone else is training.',
]

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

export async function cancelAllAlarms(): Promise<void> {
  if (!isNative) return
  await LocalNotifications.cancel({
    notifications: ALL_ALARM_IDS.map((id) => ({ id })),
  })
}

export async function scheduleAlarms(
  amReminder: string,
  pmSessionTime: string,
  pmLeadMin: number,
): Promise<void> {
  if (!isNative) return
  const permitted = await requestNotificationPermission()
  if (!permitted) return

  await cancelAllAlarms()
  await LocalNotifications.cancel({ notifications: [{ id: LEAVE_BY_ID }] })

  // ── Morning alarm sequence ────────────────────────────────────────────────
  const { hour: amH, minute: amM } = parseTime(amReminder)
  const base = nextOccurrence(amH, amM)

  const snooze1 = addMinutes(base, 9)
  const snooze2 = addMinutes(base, 18)
  const snooze3 = addMinutes(base, 27)
  // Nuclear starts at +36 min, fires every 2 min for 40 min
  const nuclearDates = NUCLEAR_IDS.map((_, i) => addMinutes(base, 36 + i * 2))

  await LocalNotifications.schedule({
    notifications: [
      {
        id: ALARM_BASE_ID,
        title: 'Waymark',
        body: `It's ${formatTime12(base)}. You said you wanted this.`,
        schedule: { at: base },
        actionTypeId: 'alarm',
        extra: { type: 'alarm' },
      },
      {
        id: ALARM_SNOOZE_1_ID,
        title: 'Waymark',
        body: 'Still in bed. Interesting choice.',
        schedule: { at: snooze1 },
        actionTypeId: 'alarm',
        extra: { type: 'alarm' },
      },
      {
        id: ALARM_SNOOZE_2_ID,
        title: 'Waymark',
        body: "You're going to skip. Just say it.",
        schedule: { at: snooze2 },
        actionTypeId: 'alarm',
        extra: { type: 'alarm' },
      },
      {
        id: ALARM_SNOOZE_3_ID,
        title: 'Waymark',
        body: 'Last one. After this I get mean.',
        schedule: { at: snooze3 },
        actionTypeId: 'alarmNuclear',
        extra: { type: 'alarm' },
      },
      ...NUCLEAR_IDS.map((id, i) => ({
        id,
        title: 'Waymark',
        body: NUCLEAR_COPY[i],
        schedule: { at: nuclearDates[i] },
        actionTypeId: 'alarmNuclear',
        extra: { type: 'alarmNuclear' },
      })),
    ],
  })

  // ── PM leave-by reminder ──────────────────────────────────────────────────
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
    })
  }
  notifications.push({
    id: CUE_ROUND_END,
    title: 'Waymark',
    body: 'Rest.',
    schedule: { at: roundEndAt },
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
    })
  }
  notifications.push({
    id: CUE_REST_END,
    title: 'Waymark',
    body: 'Go.',
    schedule: { at: restEndAt },
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

// Single cue for strength set rest — fires when rest is over.
export async function scheduleStrengthRestEnd(restSec: number): Promise<void> {
  if (!isNative) return
  const at = addSeconds(new Date(), restSec)
  await LocalNotifications.schedule({
    notifications: [{ id: CUE_STRENGTH_REST_END, title: 'Waymark', body: 'Next set.', schedule: { at } }],
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

  LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
    if (event.actionId === 'iAmUp') {
      await cancelAllAlarms()
    }
    // 'snooze' tapped — next notification is already scheduled, nothing extra needed
  })
}
