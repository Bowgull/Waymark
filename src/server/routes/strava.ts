// Strava OAuth + token storage + activity ingestion.
// Single-user app: one row in strava_tokens (id='default'). Access tokens live 6 hours,
// refresh tokens are long-lived; getStravaAccessToken refreshes transparently.
//
// Ingestion pipeline:
//   webhook POST /webhook  → aspect_type=create → ingestStravaActivity
//   Today mount             → /poll-recent      → ingest any recent unlinked activities
// Both paths dedupe on run_sessions.strava_activity_id (unique index).
//
// Match logic: new activity → look for planned running session on same local date
// with no existing strava link. Found → attachment_status='auto_pending' (user confirms
// inline on Today). None → create a new sessions row + run_sessions with
// attachment_status='orphan'. Confirm/reassign/dismiss routes finalize the state.

import { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { createDB } from '../../db/client'
import { runSessions, runSplits, sessions, stravaTokens, trainingBlocks, userProfile } from '../../db/schema'
import { isoToEpochDay } from '../../lib/dates'
import { assessRunCompletion } from '../../lib/trainingReality'

type Bindings = {
  DB: D1Database
  STRAVA_CLIENT_ID: string
  STRAVA_CLIENT_SECRET: string
  STRAVA_WEBHOOK_VERIFY_TOKEN: string
  DEMO_MODE?: string
}

const SCOPES = 'read,activity:read_all'
const AUTH_URL = 'https://www.strava.com/oauth/authorize'
const TOKEN_URL = 'https://www.strava.com/oauth/token'
const DEAUTH_URL = 'https://www.strava.com/oauth/deauthorize'
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const ACTIVITY_URL = 'https://www.strava.com/api/v3/activities'
const POLL_WINDOW_SEC = 14 * 24 * 60 * 60 // 14 days — webhook is the real-time path, poll is the backfill for missed days

const strava = new Hono<{ Bindings: Bindings }>()

strava.get('/authorize', (c) => {
  const clientId = c.env.STRAVA_CLIENT_ID
  if (!clientId) return c.json({ error: 'STRAVA_CLIENT_ID not configured' }, 500)
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', getRedirectUri(c.req.url))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('approval_prompt', 'auto')
  url.searchParams.set('scope', SCOPES)
  return c.redirect(url.toString())
})

strava.get('/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')
  if (error) return c.redirect(`/api/strava/error?reason=denied`)
  if (!code) return c.redirect(`/api/strava/error?reason=missing_code`)

  const clientId = c.env.STRAVA_CLIENT_ID
  const clientSecret = c.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return c.redirect(`/api/strava/error?reason=not_configured`)
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  })

  const res = await fetch(TOKEN_URL, { method: 'POST', body })
  if (!res.ok) {
    const text = await res.text()
    console.error('[strava] token exchange failed', res.status, text)
    return c.redirect(`/api/strava/error?reason=token_exchange_failed`)
  }

  const data = await res.json() as {
    access_token: string
    refresh_token: string
    expires_at: number
    scope?: string
    athlete?: { id: number; firstname?: string; lastname?: string }
  }

  // Strava always returns athlete on authorization_code exchange. If it's
  // missing, something is deeply wrong. Fail loudly rather than storing a
  // bogus athleteId=0 that would collide with real user 0 and break ingest.
  if (!data.athlete || typeof data.athlete.id !== 'number') {
    console.error('[strava] token exchange missing athlete', data)
    return c.redirect(`/api/strava/error?reason=token_exchange_failed`)
  }

  // Required scopes for ingestion. If the user deselected activity:read_all
  // in Strava's consent screen, we can store the token but ingest will 401.
  // Log loudly so we can diagnose later; the error page lives in Settings flow.
  const scope = data.scope ?? SCOPES
  const required = ['read', 'activity:read_all']
  const granted = new Set(parseScopes(scope))
  const missing = required.filter(s => !granted.has(s))
  if (missing.length > 0) {
    console.warn('[strava] granted scope missing required permissions', { scope, missing })
  }

  const db = createDB(c.env)
  const now = Date.now()
  const athleteName =
    [data.athlete.firstname, data.athlete.lastname].filter(Boolean).join(' ') || null

  await db.delete(stravaTokens).where(eq(stravaTokens.id, 'default'))
  await db.insert(stravaTokens).values({
    id: 'default',
    athleteId: data.athlete.id,
    athleteName,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    scope,
    connectedAt: now,
    updatedAt: now,
  })

  const displayName = athleteName ?? 'athlete'
  return c.redirect(`/api/strava/success?name=${encodeURIComponent(displayName)}`)
})

strava.get('/success', (c) => {
  const name = c.req.query('name') ?? 'athlete'
  return c.html(renderStravaPage({
    title: 'Strava Connected',
    heading: 'Connected',
    body: `Welcome, ${escapeHtml(name)}. Your runs will log themselves.`,
    hint: 'You can close this tab and return to Waymark.',
  }))
})

strava.get('/error', (c) => {
  const reason = c.req.query('reason') ?? 'unknown'
  const detail = STRAVA_ERROR_COPY[reason] ?? 'Something went sideways. Try again from Settings.'
  return c.html(renderStravaPage({
    title: 'Strava Connection Failed',
    heading: 'Not connected',
    body: detail,
    hint: 'Close this tab and try again from Waymark.',
  }))
})

strava.get('/status', async (c) => {
  const db = createDB(c.env)
  const [row] = await db.select().from(stravaTokens).where(eq(stravaTokens.id, 'default'))
  if (!row) return c.json({ connected: false })
  const token = await getStravaAccessToken(c.env)
  const missingScopes = ['read', 'activity:read_all'].filter(s => !parseScopes(row.scope).includes(s))
  return c.json({
    connected: true,
    athleteId: row.athleteId,
    athleteName: row.athleteName,
    scope: row.scope,
    connectedAt: row.connectedAt,
    expiresAt: row.expiresAt,
    clientConfigured: Boolean(c.env.STRAVA_CLIENT_ID && c.env.STRAVA_CLIENT_SECRET),
    requiredScopesGranted: missingScopes.length === 0,
    missingScopes,
    syncStatus: token ? 'ready' : 'refresh_failed',
  })
})

// Strava subscription verification. One-time on subscription creation.
strava.get('/webhook', (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')
  const expected = c.env.STRAVA_WEBHOOK_VERIFY_TOKEN

  if (mode !== 'subscribe' || !token || !challenge) {
    return c.json({ error: 'bad_request' }, 400)
  }
  if (!expected || token !== expected) {
    console.error('[strava-webhook] verify token mismatch')
    return c.json({ error: 'forbidden' }, 403)
  }
  return c.json({ 'hub.challenge': challenge })
})

// Activity events from Strava. Must respond 200 within 2s, so we ack immediately
// and ingest via c.executionCtx.waitUntil so the platform keeps the worker alive
// past the response without blocking Strava's retry clock.
strava.post('/webhook', async (c) => {
  let body: StravaWebhookEvent | null = null
  try {
    body = await c.req.json<StravaWebhookEvent>()
  } catch {
    // Ping or malformed — ack so Strava doesn't retry.
  }
  if (body && body.object_type === 'activity' && body.aspect_type === 'create') {
    c.executionCtx.waitUntil(
      ingestStravaActivity(body.object_id, c.env).catch(err => {
        console.error('[strava-webhook] ingest failed', body!.object_id, err)
      }),
    )
  }
  return c.json({ ok: true })
})

// Safety net. Called silently on Today mount. Ingests any recent activity
// not yet linked in run_sessions. Bounded to last 48h.
strava.post('/poll-recent', async (c) => {
  // Distinguish "no token row" from "refresh failed" so a transient network
  // blip during refresh doesn't make the app show "not connected" when the
  // user really is connected.
  const db = createDB(c.env)
  const [row] = await db.select().from(stravaTokens).where(eq(stravaTokens.id, 'default'))
  if (!row) return c.json({ ingested: 0, connected: false })

  const token = await getStravaAccessToken(c.env)
  if (!token) {
    console.error('[strava-poll] token refresh failed for connected athlete', row.athleteId)
    return c.json({ ingested: 0, connected: true, error: 'refresh_failed' })
  }

  const after = Math.floor(Date.now() / 1000) - POLL_WINDOW_SEC
  const url = `${ACTIVITIES_URL}?after=${after}&per_page=30`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    console.error('[strava-poll] list failed', res.status, await res.text().catch(() => ''))
    return c.json({ ingested: 0, connected: true, error: `strava_${res.status}` })
  }

  const list = await res.json() as Array<{ id: number; type: string; sport_type?: string }>
  const runs = list.filter(a => a.type === 'Run' || a.sport_type === 'Run')
  let ingested = 0
  for (const act of runs) {
    const result = await ingestStravaActivity(act.id, c.env)
    if (result.status === 'ingested') ingested += 1
    else if (result.status === 'fetch_failed' || result.status === 'no_token') {
      console.error('[strava-poll] ingest non-ok', { activityId: act.id, result })
    }
  }
  return c.json({ ingested, connected: true })
})

// User taps Confirm on an auto_pending match. Locks the link and marks the
// parent session completed with activity totals.
strava.post('/activity/:activityId/confirm', async (c) => {
  const activityId = Number(c.req.param('activityId'))
  if (!Number.isFinite(activityId)) return c.json({ error: 'bad_activity_id' }, 400)
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const [run] = await db.select().from(runSessions).where(eq(runSessions.stravaActivityId, activityId))
  if (!run) return c.json({ error: 'not_found' }, 404)

  await db.update(runSessions)
    .set({ attachmentStatus: 'confirmed' })
    .where(eq(runSessions.stravaActivityId, activityId))

  await db.update(sessions)
    .set({
      status: 'completed',
      completedAt: nowSec,
      durationSec: run.durationSec,
    })
    .where(eq(sessions.id, run.sessionId))

  return c.json({ ok: true })
})

// User taps Reassign → picks a different planned session for this activity.
strava.post('/activity/:activityId/reassign', async (c) => {
  const activityId = Number(c.req.param('activityId'))
  if (!Number.isFinite(activityId)) return c.json({ error: 'bad_activity_id' }, 400)
  const { newSessionId } = await c.req.json<{ newSessionId: string }>()
  if (!newSessionId) return c.json({ error: 'newSessionId required' }, 400)

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const [run] = await db.select().from(runSessions).where(eq(runSessions.stravaActivityId, activityId))
  if (!run) return c.json({ error: 'not_found' }, 404)
  const [target] = await db.select().from(sessions).where(eq(sessions.id, newSessionId))
  if (!target) return c.json({ error: 'target_not_found' }, 404)

  const prevSessionId = run.sessionId
  await db.update(runSessions)
    .set({ sessionId: newSessionId, attachmentStatus: 'confirmed' })
    .where(eq(runSessions.stravaActivityId, activityId))

  await db.update(sessions)
    .set({
      status: 'completed',
      completedAt: nowSec,
      durationSec: run.durationSec,
    })
    .where(eq(sessions.id, newSessionId))

  // If the previous parent was an orphan session (created by ingestion), drop
  // it so the old row vanishes from Today. Planned-match sources are left alone.
  if (prevSessionId !== newSessionId) {
    const [prev] = await db.select().from(sessions).where(eq(sessions.id, prevSessionId))
    if (prev && prev.weekPlanId == null && prev.notes == null) {
      await db.delete(sessions).where(eq(sessions.id, prevSessionId))
    }
  }

  return c.json({ ok: true })
})

// User taps "not training" — Strava logged a hike, bike, walk etc. Drops the
// run_session. If the parent session was a synthetic orphan, drop that too.
strava.post('/activity/:activityId/dismiss', async (c) => {
  const activityId = Number(c.req.param('activityId'))
  if (!Number.isFinite(activityId)) return c.json({ error: 'bad_activity_id' }, 400)
  const db = createDB(c.env)
  const [run] = await db.select().from(runSessions).where(eq(runSessions.stravaActivityId, activityId))
  if (!run) return c.json({ ok: true })

  await db.delete(runSplits).where(eq(runSplits.runSessionId, run.id))
  await db.delete(runSessions).where(eq(runSessions.id, run.id))

  if (run.attachmentStatus === 'orphan') {
    await db.delete(sessions).where(eq(sessions.id, run.sessionId))
  }
  return c.json({ ok: true })
})

// Admin: manage the Strava push subscription. Strava only allows one
// subscription per application, so these endpoints are idempotent. The
// verify_token, callback_url, and client credentials must match the Worker
// env. Called manually (once per environment) to wire up real-time webhook
// delivery. Without this, we fall back to /poll-recent, which is fine but
// slower.
const WEBHOOK_CALLBACK_URL = 'https://waymark.bocas-joshua.workers.dev/api/strava/webhook'
const SUBSCRIPTIONS_URL = 'https://www.strava.com/api/v3/push_subscriptions'

strava.get('/subscription', async (c) => {
  const url = `${SUBSCRIPTIONS_URL}?client_id=${c.env.STRAVA_CLIENT_ID}&client_secret=${c.env.STRAVA_CLIENT_SECRET}`
  const res = await fetch(url)
  const text = await res.text()
  return c.json({ status: res.status, body: safeParseJson(text) })
})

strava.post('/subscription', async (c) => {
  const body = new URLSearchParams({
    client_id: c.env.STRAVA_CLIENT_ID,
    client_secret: c.env.STRAVA_CLIENT_SECRET,
    callback_url: WEBHOOK_CALLBACK_URL,
    verify_token: c.env.STRAVA_WEBHOOK_VERIFY_TOKEN,
  })
  const res = await fetch(SUBSCRIPTIONS_URL, { method: 'POST', body })
  const text = await res.text()
  return c.json({ status: res.status, body: safeParseJson(text) })
})

strava.delete('/subscription/:id', async (c) => {
  const id = c.req.param('id')
  const url = `${SUBSCRIPTIONS_URL}/${id}?client_id=${c.env.STRAVA_CLIENT_ID}&client_secret=${c.env.STRAVA_CLIENT_SECRET}`
  const res = await fetch(url, { method: 'DELETE' })
  const text = await res.text().catch(() => '')
  return c.json({ status: res.status, body: text ? safeParseJson(text) : null })
})

/**
 * Demo-mode Strava connect.
 *
 * No OAuth, no real Strava call. Marks the user as connected with a fake
 * athlete and seeds two recent run_sessions matched to the most recent
 * planned running sessions, so the Today and History views show "Strava
 * runs" without ever hitting Strava.
 *
 * Only enabled when env.DEMO_MODE === 'true'. Returns 404 otherwise so
 * the route is invisible in production.
 */
strava.post('/demo-connect', async (c) => {
  if (c.env.DEMO_MODE !== 'true') {
    return c.json({ error: 'not_found' }, 404)
  }

  const db = createDB(c.env)
  const now = Date.now()

  await db.delete(stravaTokens).where(eq(stravaTokens.id, 'default'))
  await db.insert(stravaTokens).values({
    id: 'default',
    athleteId: 999000001,
    athleteName: 'Demo Athlete',
    accessToken: 'demo_access_token',
    refreshToken: 'demo_refresh_token',
    expiresAt: Math.floor(now / 1000) + 60 * 60 * 24 * 30,
    scope: 'read,activity:read_all,profile:read_all',
    connectedAt: now,
    updatedAt: now,
  })

  // Attach fake Strava runs to up to two recent running sessions.
  const recentRunSessions = await db
    .select({ id: sessions.id, completedAt: sessions.completedAt })
    .from(sessions)
    .where(inArray(sessions.type, ['foundation_run', 'running']))
    .orderBy(desc(sessions.completedAt))
    .limit(2)

  for (let i = 0; i < recentRunSessions.length; i++) {
    const s = recentRunSessions[i]
    const fakeStravaId = 9_000_000_000 + Math.floor(Math.random() * 1_000_000)
    const distanceKm = i === 0 ? 6.2 : 8.1
    const durationSec = i === 0 ? 32 * 60 + 14 : 44 * 60 + 50
    const paceSecKm = Math.round(durationSec / distanceKm)

    await db.delete(runSessions).where(eq(runSessions.sessionId, s.id))
    await db.insert(runSessions).values({
      id: `run_demo_${s.id}`,
      sessionId: s.id,
      runType: 'easy',
      distanceKm,
      durationSec,
      paceSecKm,
      isIndoor: 0,
      avgHr: i === 0 ? 148 : 152,
      maxHr: i === 0 ? 168 : 174,
      zoneSeconds: JSON.stringify({ z1: 240, z2: durationSec - 600, z3: 360, z4: 0, z5: 0 }),
      elevationGainM: i === 0 ? 32 : 88,
      source: 'strava',
      stravaActivityId: fakeStravaId,
      attachmentStatus: 'auto_confirmed',
    })
  }

  return c.json({
    ok: true,
    demo: true,
    athleteName: 'Demo Athlete',
    runsAttached: recentRunSessions.length,
  })
})

strava.post('/disconnect', async (c) => {
  const db = createDB(c.env)
  const [row] = await db.select().from(stravaTokens).where(eq(stravaTokens.id, 'default'))
  if (row) {
    try {
      await fetch(DEAUTH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${row.accessToken}` },
      })
    } catch (e) {
      console.warn('[strava] deauthorize call failed, clearing local tokens anyway', e)
    }
    await db.delete(stravaTokens).where(eq(stravaTokens.id, 'default'))
  }
  return c.json({ ok: true })
})

export { strava }

// ─── Success / error pages ─────────────────────────────────────

const STRAVA_ERROR_COPY: Record<string, string> = {
  denied: 'You cancelled the Strava authorization.',
  missing_code: 'Strava did not return an authorization code.',
  token_exchange_failed: 'Strava would not exchange the code for a token.',
  not_configured: 'Waymark is missing its Strava client secrets. Check Worker config.',
}

function safeParseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

function getRedirectUri(requestUrl: string): string {
  const origin = new URL(requestUrl).origin
  return `${origin}/api/strava/callback`
}

function parseScopes(scope: string | null | undefined): string[] {
  return (scope ?? '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderStravaPage(opts: { title: string; heading: string; body: string; hint: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Geist:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; min-height: 100dvh; background: #0a0a0a; color: #e8e6e1; font-family: 'Geist', ui-sans-serif, system-ui, sans-serif; }
  body { display: flex; align-items: center; justify-content: center; padding: 24px; }
  main { max-width: 420px; text-align: center; }
  h1 { font-family: 'Cinzel', serif; font-weight: 500; font-size: 28px; letter-spacing: 0.02em; margin: 0 0 16px; color: #d4af37; }
  p { font-size: 15px; line-height: 1.55; margin: 0 0 12px; color: #cfcac0; }
  p.hint { font-size: 13px; color: #8a857c; margin-top: 24px; }
  .mark { display: inline-block; width: 44px; height: 2px; background: #d4af37; opacity: 0.6; margin: 0 auto 20px; }
</style>
</head>
<body>
<main>
  <div class="mark"></div>
  <h1>${escapeHtml(opts.heading)}</h1>
  <p>${opts.body}</p>
  <p class="hint">${escapeHtml(opts.hint)}</p>
</main>
</body>
</html>`
}

// ─── Token refresh helper ──────────────────────────────────────

// Called by ingestion code. Refreshes the access token on demand.
export async function getStravaAccessToken(env: Bindings): Promise<string | null> {
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    console.error('[strava] refresh skipped: client credentials missing')
    return null
  }

  const db = createDB(env)
  const [row] = await db.select().from(stravaTokens).where(eq(stravaTokens.id, 'default'))
  if (!row) return null

  const nowSec = Math.floor(Date.now() / 1000)
  if (row.expiresAt > nowSec + 60) return row.accessToken

  const body = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    client_secret: env.STRAVA_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: row.refreshToken,
  })
  const res = await fetch(TOKEN_URL, { method: 'POST', body })
  if (!res.ok) {
    console.error('[strava] refresh failed', res.status, await res.text())
    return null
  }
  const data = await res.json() as {
    access_token: string
    refresh_token: string
    expires_at: number
  }

  await db.update(stravaTokens)
    .set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      updatedAt: Date.now(),
    })
    .where(eq(stravaTokens.id, 'default'))

  return data.access_token
}

// ─── Ingestion ─────────────────────────────────────────────────

type StravaWebhookEvent = {
  object_type: 'activity' | 'athlete'
  object_id: number
  aspect_type: 'create' | 'update' | 'delete'
  owner_id: number
  updates?: Record<string, string>
}

export type StravaActivity = {
  id: number
  type: string
  sport_type?: string
  name?: string
  start_date: string           // ISO UTC
  start_date_local: string     // ISO local (Z-suffixed but represents local wall time)
  distance: number             // meters
  moving_time: number          // seconds
  total_elevation_gain?: number
  average_heartrate?: number
  max_heartrate?: number
  trainer?: boolean
  splits_metric?: Array<{
    split: number
    moving_time: number
    average_heartrate?: number
    elevation_difference?: number
  }>
}

type StravaStreams = {
  heartrate?: { data: number[] }
  time?: { data: number[] }
}

type StravaSplit = NonNullable<StravaActivity['splits_metric']>[number]

export type StravaRunData = {
  localISO: string
  epochDay: number
  completedAt: number
  distanceKm: number | null
  durationSec: number
  paceSecKm: number | null
  isIndoor: 0 | 1
  avgHr: number | null
  maxHr: number | null
  elevationGainM: number | null
}

export type StravaSplitData = {
  kmIndex: number
  durationSec: number
  avgHr: number | null
  elevationGainM: number | null
}

type IngestResult =
  | { status: 'ingested'; runSessionId: string; attachmentStatus: 'auto_pending' | 'orphan'; maxHrBumped: null | { from: number | null; to: number } }
  | { status: 'duplicate' }
  | { status: 'non_run' }
  | { status: 'no_token' }
  | { status: 'fetch_failed'; code: number }

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = 'cause' in error ? (error as Error & { cause?: unknown }).cause : null
    return `${error.message}${cause ? ` ${errorText(cause)}` : ''}`
  }
  return String(error)
}

export async function ingestStravaActivity(activityId: number, env: Bindings): Promise<IngestResult> {
  const db = createDB(env)

  const [existing] = await db.select().from(runSessions).where(eq(runSessions.stravaActivityId, activityId))
  if (existing) return { status: 'duplicate' }

  const token = await getStravaAccessToken(env)
  if (!token) return { status: 'no_token' }

  const actRes = await fetch(`${ACTIVITY_URL}/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!actRes.ok) {
    const text = await actRes.text().catch(() => '')
    console.error('[strava-ingest] activity fetch failed', activityId, actRes.status, text)
    return { status: 'fetch_failed', code: actRes.status }
  }
  const act = await actRes.json() as StravaActivity

  if (act.type !== 'Run' && act.sport_type !== 'Run') {
    return { status: 'non_run' }
  }

  const runData = mapStravaActivityToRunData(act)
  const epochDay = runData.epochDay
  const nowSec = Math.floor(Date.now() / 1000)

  // Find a planned running session on this date with no existing strava link.
  // Matches both 'running' and 'foundation_run' (Zone 2) session types.
  // A session is considered "already claimed" only if it has a run_sessions row
  // with stravaActivityId set — a locally-started run (via Start Run button)
  // creates a row WITHOUT stravaActivityId, which we'll upgrade in place.
  // Skipped sessions are NOT auto-matched: if the user marked a day skipped
  // (sick, rest) and Strava picks up a light activity, we create an orphan
  // instead so the user explicitly reassigns it. Silent un-skipping violated
  // the coach-silently-but-don't-decide-for-the-user principle.
  const planned = await db.select().from(sessions)
    .where(and(
      inArray(sessions.type, ['running', 'foundation_run']),
      eq(sessions.scheduledDate, epochDay),
    ))
  // Only pull run_sessions for today's planned sessions — the old global scan
  // grew O(all-time-runs) per ingest and was the hot-path bottleneck during
  // /poll-recent bursts.
  const plannedIds = planned.map(s => s.id)
  const runsForPlanned = plannedIds.length > 0
    ? await db.select().from(runSessions).where(inArray(runSessions.sessionId, plannedIds))
    : []
  const stravaLinkedSessionIds = new Set(
    runsForPlanned.filter(r => r.stravaActivityId != null).map(r => r.sessionId),
  )
  const candidate = planned.find(s =>
    s.status !== 'completed' &&
    s.status !== 'skipped' &&
    !stravaLinkedSessionIds.has(s.id),
  )

  let parentSessionId: string
  let attachmentStatus: 'auto_pending' | 'orphan'
  if (candidate) {
    parentSessionId = candidate.id
    attachmentStatus = 'auto_pending'
  } else {
    const [activeBlock] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active'))
    const blockStartedAt = activeBlock?.startedAt ?? nowSec
    const blockWeek = activeBlock
      ? Math.min(Math.max(Math.floor((nowSec - blockStartedAt) / (7 * 86400)) + 1, 1), activeBlock.totalWeeks)
      : null
    parentSessionId = crypto.randomUUID()
    await db.insert(sessions).values({
      id: parentSessionId,
      type: 'running',
      scheduledDate: epochDay,
      timeSlot: null,
      blockType: activeBlock?.blockType ?? 'fighter',
      blockWeek,
      status: 'completed',
      completedAt: runData.completedAt,
      durationSec: runData.durationSec,
      createdAt: nowSec,
    })
    attachmentStatus = 'orphan'
  }

  // If a locally-started run_sessions row already exists for this parent
  // session (user tapped Start Run before Strava webhook arrived), upgrade
  // that row in place. The unique index on session_id blocks a second insert.
  const [existingForParent] = await db.select().from(runSessions)
    .where(eq(runSessions.sessionId, parentSessionId))

  // Seed max_hr from Tanaka (208 - 0.7 × age) if profile has DOB but no
  // max_hr yet. Observed max from real runs will overwrite this. Without the
  // seed, zones never compute on the first run.
  const [profile] = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))
  let effectiveMaxHr = profile?.maxHr ?? null
  if (effectiveMaxHr == null && profile?.dob) {
    const tanaka = tanakaMaxHrFromDob(profile.dob)
    if (tanaka != null) {
      await db.update(userProfile)
        .set({ maxHr: tanaka, updatedAt: nowSec })
        .where(eq(userProfile.id, 'default'))
      effectiveMaxHr = tanaka
    }
  }

  let zoneSeconds: { z1: number; z2: number; z3: number; z4: number; z5: number } | null = null
  if (effectiveMaxHr && act.average_heartrate != null) {
    const streams = await fetchStreams(activityId, token).catch(() => null)
    if (streams?.heartrate?.data && streams.time?.data) {
      zoneSeconds = bucketZones(streams.heartrate.data, streams.time.data, effectiveMaxHr)
    }
  }

  let runSessionId: string
  if (existingForParent) {
    runSessionId = existingForParent.id
    const reality = assessRunCompletion({
      plannedDurationSec: existingForParent.plannedDurationSec,
      completedDurationSec: runData.durationSec,
    })
    try {
      await db.update(runSessions).set({
        distanceKm: runData.distanceKm,
        durationSec: runData.durationSec,
        completionRatio: reality.completionRatio,
        completionStatus: reality.completionStatus,
        paceSecKm: runData.paceSecKm,
        isIndoor: act.trainer ? runData.isIndoor : (existingForParent.isIndoor ?? 0),
        avgHr: runData.avgHr,
        maxHr: runData.maxHr,
        zoneSeconds: zoneSeconds ? JSON.stringify(zoneSeconds) : null,
        elevationGainM: runData.elevationGainM,
        source: 'strava',
        stravaActivityId: activityId,
        attachmentStatus,
      }).where(eq(runSessions.id, runSessionId))
    } catch (error) {
      const [duplicate] = await db.select().from(runSessions).where(eq(runSessions.stravaActivityId, activityId))
      if (duplicate) return { status: 'duplicate' }
      console.error('[strava-ingest] run session update failed', activityId, errorText(error))
      throw error
    }
  } else {
    runSessionId = crypto.randomUUID()
    try {
      await db.insert(runSessions).values({
        id: runSessionId,
        sessionId: parentSessionId,
        planWeek: null,
        runType: null,
        distanceKm: runData.distanceKm,
        durationSec: runData.durationSec,
        paceSecKm: runData.paceSecKm,
        isIndoor: runData.isIndoor,
        avgHr: runData.avgHr,
        maxHr: runData.maxHr,
        zoneSeconds: zoneSeconds ? JSON.stringify(zoneSeconds) : null,
        elevationGainM: runData.elevationGainM,
        source: 'strava',
        stravaActivityId: activityId,
        attachmentStatus,
      })
    } catch (error) {
      const [duplicate] = await db.select().from(runSessions).where(eq(runSessions.stravaActivityId, activityId))
      if (duplicate) return { status: 'duplicate' }
      console.error('[strava-ingest] run session insert failed', activityId, errorText(error))
      throw error
    }
  }

  if (act.splits_metric && act.splits_metric.length > 0) {
    // Batch insert so a marathon with 42 splits doesn't fire 42 serial writes
    // and can't leave half the splits behind on mid-loop failure. D1 has a
    // 100-param cap per statement; each split binds 6 columns so we chunk at
    // 15 rows (90 params) to stay comfortably under.
    const rows = mapStravaSplits(act.splits_metric).map(sp => ({
      id: crypto.randomUUID(),
      runSessionId,
      kmIndex: sp.kmIndex,
      durationSec: sp.durationSec,
      avgHr: sp.avgHr,
      elevationGainM: sp.elevationGainM,
    }))
    const CHUNK = 15
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(runSplits).values(rows.slice(i, i + CHUNK))
    }
  }

  // Spike clamp: strap contact loss / static can produce false reads in the
  // 220-250 range. Reject obvious noise. 215 is above any realistic trained-
  // human max and well below typical strap glitch values.
  let maxHrBumped: { from: number | null; to: number } | null = null
  if (act.max_heartrate && profile) {
    const observed = Math.round(act.max_heartrate)
    const current = effectiveMaxHr ?? profile.maxHr ?? 0
    const isNoise = observed > 215
    if (!isNoise && observed > current) {
      await db.update(userProfile)
        .set({ maxHr: observed, updatedAt: Date.now() })
        .where(eq(userProfile.id, 'default'))
      maxHrBumped = { from: profile.maxHr ?? null, to: observed }
    }
  }

  return { status: 'ingested', runSessionId, attachmentStatus, maxHrBumped }
}

async function fetchStreams(activityId: number, token: string): Promise<StravaStreams | null> {
  const url = `${ACTIVITY_URL}/${activityId}/streams?keys=heartrate,time&key_by_type=true`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return await res.json() as StravaStreams
}

// Tanaka formula for age-predicted max HR: 208 - 0.7 × age. More accurate
// than the classic 220 - age for trained adults. Returns null if DOB is
// unparseable or yields an implausible age.
export function mapStravaActivityToRunData(act: StravaActivity): StravaRunData {
  const localISO = act.start_date_local.slice(0, 10)
  const distanceKm = act.distance ? act.distance / 1000 : null
  const paceSecKm = distanceKm && act.moving_time
    ? Math.round(act.moving_time / distanceKm)
    : null

  return {
    localISO,
    epochDay: isoToEpochDay(localISO),
    completedAt: Math.floor(new Date(act.start_date).getTime() / 1000),
    distanceKm,
    durationSec: act.moving_time,
    paceSecKm,
    isIndoor: act.trainer ? 1 : 0,
    avgHr: act.average_heartrate != null ? Math.round(act.average_heartrate) : null,
    maxHr: act.max_heartrate != null ? Math.round(act.max_heartrate) : null,
    elevationGainM: act.total_elevation_gain != null ? Math.round(act.total_elevation_gain) : null,
  }
}

export function mapStravaSplits(splits: StravaSplit[]): StravaSplitData[] {
  return splits.map(sp => ({
    kmIndex: sp.split,
    durationSec: sp.moving_time,
    avgHr: sp.average_heartrate != null ? Math.round(sp.average_heartrate) : null,
    elevationGainM: sp.elevation_difference != null ? Math.round(sp.elevation_difference) : null,
  }))
}

export function tanakaMaxHrFromDob(dob: string): number | null {
  const birth = new Date(dob)
  if (isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  if (age < 10 || age > 100) return null
  return Math.round(208 - 0.7 * age)
}

// Bucket HR samples into Z1-Z5 by % of max HR. Z1 <60, Z2 60-70, Z3 70-80,
// Z4 80-90, Z5 >=90. Each sample's dwell is the gap to the next time point.
export function bucketZones(hr: number[], time: number[], maxHr: number): { z1: number; z2: number; z3: number; z4: number; z5: number } {
  const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  const n = Math.min(hr.length, time.length)
  for (let i = 0; i < n; i++) {
    const dt = i < n - 1 ? Math.max(0, time[i + 1] - time[i]) : 1
    const pct = hr[i] / maxHr
    if (pct < 0.6) zones.z1 += dt
    else if (pct < 0.7) zones.z2 += dt
    else if (pct < 0.8) zones.z3 += dt
    else if (pct < 0.9) zones.z4 += dt
    else zones.z5 += dt
  }
  return zones
}
