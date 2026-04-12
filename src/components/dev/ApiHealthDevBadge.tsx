import { useEffect, useState } from 'react'
import { getApiBaseUrl } from '../../lib/apiBase'

/**
 * Dev-only: confirms the app can reach `GET /api/health` on the configured API base.
 */
export function ApiHealthDevBadge() {
  const [line, setLine] = useState<string>('loading…')

  useEffect(() => {
    const base = getApiBaseUrl()
    fetch(`${base}/api/health`)
      .then(async (r) => {
        const body = await r.text()
        setLine(`${r.status} ${body}`)
      })
      .catch((e: unknown) => {
        setLine(`error: ${e instanceof Error ? e.message : String(e)}`)
      })
  }, [])

  if (!import.meta.env.DEV) {
    return null
  }

  return (
    <p className="mt-4 max-w-full break-all px-2 text-center text-xs text-muted-foreground">
      <span className="font-mono">DEV</span> API {getApiBaseUrl()} — {line}
    </p>
  )
}
