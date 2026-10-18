// Which requests apiFetch may send twice. Reads, and writes that carry an
// Idempotency-Key (the server applies those once). A plain POST that timed out
// may already have landed; resending it could finish a session twice, rate
// combos twice or create a duplicate ad-hoc session.

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

/** A fresh key for one logical write. Reuse it for every retry of that write. */
export function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Headers for a write the server should apply once, however often it is sent. */
export function idempotencyHeaders(key: string = newIdempotencyKey()): Record<string, string> {
  return { [IDEMPOTENCY_HEADER]: key }
}

export function hasIdempotencyKey(headers: HeadersInit | undefined): boolean {
  if (!headers) return false
  const lower = IDEMPOTENCY_HEADER.toLowerCase()
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.has(IDEMPOTENCY_HEADER)
  if (Array.isArray(headers)) return headers.some(([k]) => k.toLowerCase() === lower)
  return Object.keys(headers).some(k => k.toLowerCase() === lower)
}

/** 2 = one retry allowed; 1 = send once. */
export function maxAttemptsFor(method: string, headers: HeadersInit | undefined): number {
  return IDEMPOTENT_METHODS.has(method.toUpperCase()) || hasIdempotencyKey(headers) ? 2 : 1
}
