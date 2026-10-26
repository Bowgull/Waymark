// The end-of-session logs (Log your run, the MT class log) as outbox writes:
// kept on the phone with no signal and sent in order with the session's other
// writes, so the finish never overtakes them. One key per run or class log, so
// a retry or a second tap is the same write.

export function runLogWrite(runSessionId: string, sessionId: string | null, body: Record<string, unknown>) {
  return {
    method: 'PATCH' as const,
    path: `/api/run-sessions/${runSessionId}`,
    body,
    sessionId,
    kind: 'run',
    key: `run-log-${runSessionId}`,
  }
}

export function classLogWrite(mtLogId: string, sessionId: string | null, body: Record<string, unknown>) {
  return {
    method: 'PATCH' as const,
    path: `/api/mt-class-logs/${mtLogId}`,
    body,
    sessionId,
    kind: 'class',
    key: `class-log-${mtLogId}`,
  }
}

/** A direct save that failed this way may not have landed: keep it on the phone and retry (no signal, a timeout, a 5xx). */
export function keepForRetry(err: unknown): boolean {
  const type = err != null && typeof err === 'object' ? (err as { type?: unknown }).type : undefined
  return type === 'network' || type === 'server'
}
