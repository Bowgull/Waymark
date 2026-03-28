import { Navigate, Route, Routes } from 'react-router-dom'
import { ShellLayout } from './ShellLayout'
import { HistoryPage } from '../features/history/HistoryPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { TodayPage } from '../features/today/TodayPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<ShellLayout />}>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  )
}
