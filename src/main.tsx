import { StrictMode, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SplashScreen } from '@capacitor/splash-screen'
import { AppRoutes } from './app/AppRoutes'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { LoadingScreen } from './components/ui/LoadingScreen'
import { initKeyboardHandling } from './lib/keyboard'
import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/cinzel/index.css'
import './index.css'

SplashScreen.hide().catch(() => {})
initKeyboardHandling()

function App() {
  const [showLoading, setShowLoading] = useState(true)
  const handleReady = useCallback(() => setShowLoading(false), [])

  return (
    <>
      {showLoading && <LoadingScreen onReady={handleReady} />}
      <AppRoutes />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary level="app">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
