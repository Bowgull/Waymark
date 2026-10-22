import { apiFetch } from '@/lib/api'
import { getItem as storageGet, setItem as storageSet } from '@/lib/safeStorage'

const MAX_HR_LS_KEY = 'waymark_last_seen_max_hr'

/**
 * The max-HR bump pop-up: a one-time "Max HR now N. Zones updated." when the
 * profile's max HR has risen since this phone last saw it. Kept as it was on
 * Today; its old trigger (Today's Strava poll) is gone. It runs after a recorded
 * run is saved. Returns true when the pop-up showed.
 */
export async function checkMaxHrBump(showToast: (message: string, variant?: 'info') => void): Promise<boolean> {
  try {
    const profile = await apiFetch<{ maxHr: number | null } | null>('/api/user-profile')
    if (!profile || profile.maxHr == null) return false
    const lastSeen = Number(storageGet(MAX_HR_LS_KEY) ?? '0')
    if (profile.maxHr > lastSeen) {
      storageSet(MAX_HR_LS_KEY, String(profile.maxHr))
      if (lastSeen > 0) {
        showToast(`Max HR now ${profile.maxHr}. Zones updated.`, 'info')
        return true
      }
    }
  } catch {
    // profile fetch failed; skip bump notice.
  }
  return false
}
