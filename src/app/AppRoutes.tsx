import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { ShellLayout } from './ShellLayout'
import { HistoryPage } from '../features/history/HistoryPage'
import { LibraryPage } from '../features/library/LibraryPage'
import { OnboardingPage } from '../features/onboarding/OnboardingPage'
import { ProgramPage } from '../features/program/ProgramPage'
import { WorkoutPage } from '../features/session/WorkoutPage'
import { BodyMetricsPage } from '../features/metrics/BodyMetricsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { TodayPage } from '../features/today/TodayPage'
import { initNotificationListeners, handleForegroundAlarmCheck } from '../lib/notifications'
import { apiFetch } from '../lib/api'

export function AppRoutes() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (location.pathname === '/onboarding') return
    apiFetch<{ onboardedAt: number | null } | null>('/api/user-profile')
      .then(profile => {
        if (!profile || !profile.onboardedAt) {
          navigate('/onboarding', { replace: true })
        }
      })
      .catch(() => {
        // API unavailable, skip redirect
      })
  }, [])

  useEffect(() => {
    initNotificationListeners()

    // Option C: app coming to foreground within 30 min of alarm = you're up, kill the sequence
    async function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      try {
        const settings = await apiFetch<{ amReminder: string | null } | null>('/api/settings')
        if (settings?.amReminder) {
          handleForegroundAlarmCheck(settings.amReminder)
        }
      } catch {
        // settings unavailable, skip
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return (
    <Routes>
      {/* Full-screen routes — no shell/nav */}
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/session/:id" element={<ErrorBoundary level="session"><WorkoutPage /></ErrorBoundary>} />

      <Route element={<ShellLayout />}>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<ErrorBoundary level="page"><TodayPage /></ErrorBoundary>} />
        <Route path="/program" element={<ErrorBoundary level="page"><ProgramPage /></ErrorBoundary>} />
        <Route path="/library" element={<ErrorBoundary level="page"><LibraryPage /></ErrorBoundary>} />
        <Route path="/history" element={<ErrorBoundary level="page"><HistoryPage /></ErrorBoundary>} />
        <Route path="/settings" element={<ErrorBoundary level="page"><SettingsPage /></ErrorBoundary>} />
        <Route path="/metrics" element={<ErrorBoundary level="page"><BodyMetricsPage /></ErrorBoundary>} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  )
}
