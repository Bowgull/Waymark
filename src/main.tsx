import { StrictMode, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SplashScreen } from '@capacitor/splash-screen'
import { AppRoutes } from './app/AppRoutes'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { Splash } from './world/Splash'
import { initKeyboardHandling } from './lib/keyboard'
import { PopFlapHost } from './design/PopFlapHost'
import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/cinzel/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './index.css'

// The web splash hides the native still crest on its first frame; this is the safety net.
setTimeout(() => { SplashScreen.hide().catch(() => {}) }, 4000)
initKeyboardHandling()

// eslint-disable-next-line react-refresh/only-export-components
function App() {
  // The design gallery and ?nosplash (screenshots, dev) open straight onto the app.
  const [showLoading, setShowLoading] = useState(() => !(window.location.pathname === '/design' || new URLSearchParams(window.location.search).has('nosplash')))
  const handleReady = useCallback(() => setShowLoading(false), [])

  return (
    <>
      {showLoading && <Splash onDone={handleReady} />}
      <AppRoutes />
      <PopFlapHost />
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
