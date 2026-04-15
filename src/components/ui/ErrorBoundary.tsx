import { Component, type ErrorInfo, type ReactNode } from 'react'
import logoPng from '@/assets/brand/Logo.png'

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
    console.error(`[ErrorBoundary:${this.props.level ?? 'app'}]`, error, info.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const level = this.props.level ?? 'app'

    if (level === 'app') {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] px-6 text-center">
          <img
            src={logoPng}
            alt="Waymark"
            width={64}
            height={64}
            className="mb-6 object-contain opacity-40"
            style={{ mixBlendMode: 'screen' }}
          />
          <h1
            className="mb-2 text-lg tracking-wide text-[#e8c860]"
            style={{ fontFamily: "'Cinzel Variable', serif" }}
          >
            Something went wrong
          </h1>
          <p className="mb-6 max-w-xs text-sm text-[#8a9a90]">
            An unexpected error occurred. Reload to continue.
          </p>
          <button
            onClick={this.handleReload}
            className="rounded-md border border-[#e8c860]/20 bg-[#e8c860]/10 px-6 py-3 text-sm font-medium text-[#e8c860] transition-colors active:bg-[#e8c860]/20"
          >
            Reload
          </button>
        </div>
      )
    }

    if (level === 'session') {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] px-6 text-center">
          <h1
            className="mb-2 text-lg tracking-wide text-[#e8c860]"
            style={{ fontFamily: "'Cinzel Variable', serif" }}
          >
            Session interrupted
          </h1>
          <p className="mb-6 max-w-xs text-sm text-[#8a9a90]">
            Something went wrong during your workout. You can try to resume or go back.
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleRetry}
              className="rounded-md border border-[#e8c860]/20 bg-[#e8c860]/10 px-5 py-3 text-sm font-medium text-[#e8c860] transition-colors active:bg-[#e8c860]/20"
            >
              Resume
            </button>
            <button
              onClick={() => { window.location.href = '/today' }}
              className="rounded-md border border-[#8a9a90]/20 px-5 py-3 text-sm font-medium text-[#8a9a90] transition-colors active:bg-[#8a9a90]/10"
            >
              Back to Today
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <p className="mb-4 text-sm text-muted-foreground">
          This section couldn't load.
        </p>
        <button
          onClick={this.handleRetry}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors active:bg-secondary"
        >
          Try again
        </button>
      </div>
    )
  }
}
