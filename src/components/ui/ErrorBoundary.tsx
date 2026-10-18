import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '@/lib/logger'
import { apiFetch } from '@/lib/api'
import { clearResume } from '@/lib/sessionResume'
import { PageErrorScreen, SessionInterruptedScreen } from './ErrorScreens'

interface Props {
  children: ReactNode
  level?: 'app' | 'page' | 'session'
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const level = this.props.level ?? 'app'
    console.error(`[ErrorBoundary:${level}]`, error, info.componentStack)
    logger.error('error', `ErrorBoundary(${level}) caught: ${error.message}`, {
      level,
      name: error.name,
      stack: error.stack,
      componentStack: info.componentStack,
    }, `React render crash at ${level} boundary. Component tree unmounted.`)
  }

  handleReload = () => {
    window.location.reload()
  }

  /** The session id in the URL, when the crash was on a workout screen. */
  private sessionIdFromPath(): string | null {
    const match = typeof window !== 'undefined' ? window.location.pathname.match(/\/session\/([^/]+)/) : null
    return match?.[1] ?? null
  }

  private clearSessionResume() {
    const sessionId = this.sessionIdFromPath()
    if (!sessionId) return
    try {
      clearResume(window.localStorage, sessionId)
    } catch {
      // storage unavailable
    }
  }

  handleRetry = () => {
    // The saved step may be what crashed the render: retry from the server's view.
    this.clearSessionResume()
    this.setState({ hasError: false, error: null })
  }

  handleBackToToday = () => {
    window.location.href = '/today'
  }

  handleAbandonSession = () => {
    const match = typeof window !== 'undefined' ? window.location.pathname.match(/\/session\/([^/]+)/) : null
    const sessionId = match?.[1]
    this.clearSessionResume()
    if (sessionId) {
      logger.warn('session', 'session abandoned via error boundary', { sessionId }, 'Session abandoned via error-boundary Back button. POST /abandon fired.')
      apiFetch(`/api/sessions/${sessionId}/abandon`, { method: 'POST' }).catch(() => {})
    }
    window.location.href = '/today'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const level = this.props.level ?? 'app'

    if (level === 'session') {
      return (
        <SessionInterruptedScreen
          sessionId={this.sessionIdFromPath()}
          onResume={this.handleRetry}
          onBack={this.handleAbandonSession}
        />
      )
    }

    // App and page level: name the page, say nothing is lost, RELOAD (page 38).
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
    return (
      <PageErrorScreen
        pathname={level === 'app' ? '/' : pathname}
        onReload={this.handleReload}
        onBack={level === 'page' && pathname !== '/today' ? this.handleBackToToday : undefined}
      />
    )
  }
}
