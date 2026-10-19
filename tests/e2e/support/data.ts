import type { Api } from '../fixtures'
import { todayISO } from './helpers'

/** A plain good morning: readiness reads "Good to go." */
export const GOOD_MORNING = { sleepHours: 8, sleepQuality: 4, energy: 4, soreness: 2, stress: 2, mood: 4, backToday: 4, alcoholScale: 0, herbScale: 0 }

export async function setMorning(api: Api, answers: Record<string, number | null> = GOOD_MORNING) {
  return api.post('/api/daily-logs', { date: todayISO(), ...answers })
}
