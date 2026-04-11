import { Navigate, Route, Routes } from 'react-router-dom'
import { ShellLayout } from './ShellLayout'
import { HistoryPage } from '../features/history/HistoryPage'
import { LibraryPage } from '../features/library/LibraryPage'
import { ProgramPage } from '../features/program/ProgramPage'
import { WorkoutPage } from '../features/session/WorkoutPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { TodayPage } from '../features/today/TodayPage'

export function AppRoutes() {
  return (
    <Routes>
      {/* Full-screen workout route — no shell/nav */}
      <Route path="/session/:id" element={<WorkoutPage />} />

      <Route element={<ShellLayout />}>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/program" element={<ProgramPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  )
}
