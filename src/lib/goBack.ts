import type { NavigateFunction } from 'react-router-dom'

/**
 * One back for every page you went into (page 61): history back when the app
 * came from somewhere, else to `fallback` without stacking a new entry.
 */
export function goBack(navigate: NavigateFunction, fallback: string): void {
  const idx = (typeof window !== 'undefined' ? (window.history.state as { idx?: number } | null)?.idx : 0) ?? 0
  if (idx > 0) void navigate(-1)
  else void navigate(fallback, { replace: true })
}
