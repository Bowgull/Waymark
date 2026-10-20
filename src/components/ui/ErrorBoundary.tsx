import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '@/lib/logger'
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

  handleRetry = () => {
    // H2 (page 61): RESUME keeps the save, so it carries on where it was.
    this.setState({ hasError: false, error: null })
  }

  handleBackToToday = () => {
    window.location.href = '/today'
  }

  /** BACK TO TODAY (page 61): the session stays in progress, as ‹ TODAY leaves it. */
  handleSessionToToday = () => {
    window.location.href = '/today?resume=0'
  }

  /** END AND LOG IT: the session's close (effort, then the moment), on a fresh load of the session. */
  handleEndAndLog = () => {
    const sessionId = this.sessionIdFromPath()
    window.location.href = sessionId ? `/session/${sessionId}?close=1` : '/today'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const level = this.props.level ?? 'app'

    if (level === 'session') {
      return (
        <SessionInterruptedScreen
          sessionId={this.sessionIdFromPath()}
          onResume={this.handleRetry}
          onBack={this.handleSessionToToday}
          onEnd={this.handleEndAndLog}
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
