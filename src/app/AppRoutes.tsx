import { Suspense, lazy, useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { OfflinePill, ShellLayout } from './ShellLayout'
import { WorldLayer } from '../world/WorldLayer'
import { cascadeForScreen } from '../design/cascade'
import { OnboardingPage } from '../features/onboarding/OnboardingPage'
import { WorkoutPage } from '../features/session/WorkoutPage'
import { BodyMetricsPage } from '../features/metrics/BodyMetricsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { LogsPage } from '../features/settings/LogsPage'

/**
 * The screens page 17 cascades as they open (Today, Program, Library, Ledger and
 * a session's screens); null for the rest (Settings, onboarding...), which land at once.
 */
function cascadeScreen(pathname: string): string | null {
  if (pathname === '/') return '/today'
  if (/^\/(today|program|library|history)(\/|$)/.test(pathname)) return pathname
  if (/^\/session\//.test(pathname)) return pathname
  return null
}

// Dev only: every new screen with sample data, for screenshots (never in a build).
const DesignGallery = import.meta.env.DEV ? lazy(() => import('../design/DesignGallery')) : null
import {
  initNotificationListeners,
  handleForegroundAlarmCheck,
  requestNotificationPermission,
  scheduleRedeployReminders,
  cancelRedeployReminders,
  syncAlarmsFromSettings,
} from '../lib/notifications'
import { apiFetch } from '../lib/api'
import { getTodayISO } from '../lib/dates'
import { coachLine, nextAlarmDay } from '../lib/coachLine'
import { startOutboxSync } from '../lib/outboxSync'
import { getItem as storageGet, setItem as storageSet } from '../lib/safeStorage'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { readLiveSession, sessionPathFor } from '../lib/liveSession'
import { CHECK_IN_EVENT } from '../features/blockZero/checkInTrigger'
import { BodyWatchSync } from '../features/raven/bodyWatch'

/** The morning alarm's one quiet line (page 56 item 12): what the coach moved, for the next alarm's day. */
async function coachMorningLine(amReminder: string | null | undefined): Promise<string | null> {
  return coachLine('morning', nextAlarmDay(getTodayISO(), amReminder))
}

export function AppRoutes() {
  const navigate = useNavigate()
  const location = useLocation()
  // Arm the cascade as the new screen renders, before its labels' first layout effects run (idempotent).
  cascadeForScreen(cascadeScreen(location.pathname))

  // The onboarding check, once at boot (page 59 §6 item 5), not on every tab tap.
  const profileChecked = useRef(false)
  useEffect(() => {
    if (profileChecked.current || location.pathname === '/onboarding' || location.pathname === '/design') return
    profileChecked.current = true
    apiFetch<{ onboardedAt: number | null } | null>('/api/user-profile')
      .then(profile => {
        if (!profile || !profile.onboardedAt) {
          navigate('/onboarding', { replace: true })
        }
      })
      .catch(() => {
        // API unavailable, skip redirect
      })
  }, [location.pathname, navigate])

  // Queued set saves and finishes retry on reconnect, foreground and resume.
  useEffect(() => startOutboxSync(), [])

  // Page 61 (M6): tapping the Live Activity or the Dynamic Island (waymark://session/live,
  // or waymark://session/<id>) opens the running session, not wherever the app last was.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let remove: (() => void) | null = null
    void CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      const to = sessionPathFor(url, () => { try { return readLiveSession(window.localStorage)?.sessionId ?? null } catch { return null } })
      if (to) navigate(to)
    }).then(h => { remove = () => { void h.remove() } })
    return () => remove?.()
  }, [navigate])

  // The morning alarm's I'M UP: go to Today, where the check-in cards open.
  useEffect(() => {
    const open = () => navigate('/today')
    window.addEventListener(CHECK_IN_EVENT, open)
    return () => window.removeEventListener(CHECK_IN_EVENT, open)
  }, [navigate])

  useEffect(() => {
    initNotificationListeners()

    // Ask once, at boot, then rehydrate scheduled alarms from saved settings.
    // Without the rehydrate step, alarms only existed after the user opened
    // Settings and tapped Save — fresh installs and 7-day sideload reinstalls
    // would have no OS-level alarms until then.
    if (Capacitor.isNativePlatform()) {
      ;(async () => {
        const granted = await requestNotificationPermission().catch(() => false)
        if (!granted) return
        try {
          const settings = await apiFetch<{
            amReminder: string | null
            pmSessionTime: string | null
            pmLeadMin: number | null
          } | null>('/api/settings')
          if (settings) await syncAlarmsFromSettings(settings, await coachMorningLine(settings.amReminder))
        } catch {
          // settings unavailable at boot — Settings save will reschedule later
        }
      })()
    }

    // Redeploy countdown: if the bundle is fresher than last boot,
    // cancel stale 5000/5001 notifications and schedule new ones.
    if (Capacitor.isNativePlatform()) {
      const buildTime = Number(import.meta.env.VITE_BUILD_TIME)
      if (Number.isFinite(buildTime) && buildTime > 0) {
        const lastSeen = storageGet('lastSeenBuildTime')
        if (String(buildTime) !== lastSeen) {
          ;(async () => {
            try {
              await cancelRedeployReminders()
              await scheduleRedeployReminders(buildTime)
              storageSet('lastSeenBuildTime', String(buildTime))
            } catch (e) {
              console.error('Failed to reschedule redeploy reminders:', e)
            }
          })()
        }
      }
    }

    // Option C: app coming to foreground within 30 min of alarm = you're up, kill the sequence.
    // Also re-sync the alarm sequence so tomorrow's fire is always queued — without
    // this, daily recurrence depends on the user cold-starting the app each morning.
    async function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      try {
        const settings = await apiFetch<{
          amReminder: string | null
          pmSessionTime: string | null
          pmLeadMin: number | null
        } | null>('/api/settings')
        if (!settings) return
        if (settings.amReminder) {
          await handleForegroundAlarmCheck(settings.amReminder)
        }
        await syncAlarmsFromSettings(settings, await coachMorningLine(settings.amReminder))
      } catch {
        // settings unavailable, skip
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return (
    <>
    <WorldLayer />
    {/* the raven and the injury weather (page 58): read on every world tab */}
    {location.pathname !== '/onboarding' && location.pathname !== '/design' && <BodyWatchSync />}
    <Routes>
      {/* Full-screen routes — no shell/nav */}
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/session/:id" element={<ErrorBoundary level="session"><WorkoutPage /></ErrorBoundary>} />
      <Route path="/settings/logs" element={<ErrorBoundary level="page"><LogsPage /></ErrorBoundary>} />
      {/* Settings and Body metrics: full screen on the solid dark, no tab bar (page 37 A) */}
      <Route path="/settings" element={<ErrorBoundary level="page"><SettingsPage /></ErrorBoundary>} />
      <Route path="/metrics" element={<ErrorBoundary level="page"><BodyMetricsPage /></ErrorBoundary>} />
      {DesignGallery && <Route path="/design" element={<Suspense fallback={null}><DesignGallery /></Suspense>} />}

      <Route element={<ShellLayout />}>
        <Route path="/" element={<Navigate to="/today" replace />} />
        {/* the four tabs are kept alive by the shell (TabStack): their routes only match */}
        <Route path="/today" element={null} />
        <Route path="/program" element={null} />
        <Route path="/library" element={null} />
        <Route path="/history" element={null} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
    {location.pathname !== '/design' && <OfflinePill overTabs={!/^\/(session|onboarding|settings|metrics|block-zero|dev)(\/|$)/.test(location.pathname)} />}
    </>
  )
}
