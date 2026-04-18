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
import { and, eq } from 'drizzle-orm'

import { createDB } from '../../db/client'
import { runSessions, runSplits, sessions, stravaTokens, userProfile } from '../../db/schema'
import { isoToEpochDay } from '../../lib/dates'

type Bindings = {
  DB: D1Database
  STRAVA_CLIENT_ID: string
  STRAVA_CLIENT_SECRET: string
  STRAVA_WEBHOOK_VERIFY_TOKEN: string
}

const REDIRECT_URI = 'https://waymark.bocas-joshua.workers.dev/api/strava/callback'
const SCOPES = 'read,activity:read_all'
const AUTH_URL = 'https://www.strava.com/oauth/authorize'
const TOKEN_URL = 'https://www.strava.com/oauth/token'
const DEAUTH_URL = 'https://www.strava.com/oauth/deauthorize'
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const ACTIVITY_URL = 'https://www.strava.com/api/v3/activities'
const POLL_WINDOW_SEC = 48 * 60 * 60 // 48h

const strava = new Hono<{ Bindings: Bindings }>()

strava.get('/authorize', (c) => {
  const clientId = c.env.STRAVA_CLIENT_ID
  if (!clientId) return c.json({ error: 'STRAVA_CLIENT_ID not configured' }, 500)
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('approval_prompt', 'auto')
  url.searchParams.set('scope', SCOPES)
  return c.redirect(url.toString())
})

strava.get('/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')
  if (error) return c.redirect(`/settings?strava=denied`)
  if (!code) return c.redirect(`/settings?strava=missing_code`)

  const clientId = c.env.STRAVA_CLIENT_ID
  const clientSecret = c.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return c.json({ error: 'Strava secrets not configured' }, 500)
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
    return c.redirect(`/settings?strava=token_exchange_failed`)
  }

  const data = await res.json() as {
    access_token: string
    refresh_token: string
    expires_at: number
    scope?: string
    athlete?: { id: number; firstname?: string; lastname?: string }
  }

  const db = createDB(c.env)
  const now = Date.now()
  const athleteName = data.athlete
    ? [data.athlete.firstname, data.athlete.lastname].filter(Boolean).join(' ') || null
    : null
  const scope = data.scope ?? SCOPES

  await db.delete(stravaTokens).where(eq(stravaTokens.id, 'default'))
  await db.insert(stravaTokens).values({
    id: 'default',
    athleteId: data.athlete?.id ?? 0,
    athleteName,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    scope,
    connectedAt: now,
    updatedAt: now,
  })

  return c.redirect(`/settings?strava=connected`)
})

strava.get('/status', async (c) => {
  const db = createDB(c.env)
  const [row] = await db.select().from(stravaTokens).where(eq(stravaTokens.id, 'default'))
  if (!row) return c.json({ connected: false })
  return c.json({
    connected: true,
    athleteId: row.athleteId,
    athleteName: row.athleteName,
    scope: row.scope,
    connectedAt: row.connectedAt,
    expiresAt: row.expiresAt,
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
  const token = await getStravaAccessToken(c.env)
  if (!token) return c.json({ ingested: 0, connected: false })

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
  }
  return c.json({ ingested, connected: true })
})

// User taps Confirm on an auto_pending match. Locks the link and marks the
// parent session completed with activity totals.
strava.post('/activity/:activityId/confirm', async (c) => {
  const activityId = Number(c.req.param('activityId'))
  if (!Number.isFinite(activityId)) return c.json({ error: 'bad_activity_id' }, 400)
  const db = createDB(c.env)
  const [run] = await db.select().from(runSessions).where(eq(runSessions.stravaActivityId, activityId))
  if (!run) return c.json({ error: 'not_found' }, 404)

  await db.update(runSessions)
    .set({ attachmentStatus: 'confirmed' })
    .where(eq(runSessions.stravaActivityId, activityId))

  await db.update(sessions)
    .set({
      status: 'completed',
      completedAt: Date.now(),
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
      completedAt: Date.now(),
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

// ─── Token refresh helper ──────────────────────────────────────

// Called by ingestion code. Refreshes the access token on demand.
export async function getStravaAccessToken(env: Bindings): Promise<string | null> {
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

type StravaActivity = {
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

type IngestResult =
  | { status: 'ingested'; runSessionId: string; attachmentStatus: 'auto_pending' | 'orphan'; maxHrBumped: null | { from: number | null; to: number } }
  | { status: 'duplicate' }
  | { status: 'non_run' }
  | { status: 'no_token' }
  | { status: 'fetch_failed'; code: number }

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

  const localISO = act.start_date_local.slice(0, 10)
  const epochDay = isoToEpochDay(localISO)
  const nowSec = Math.floor(Date.now() / 1000)

  // Find a planned running session on this date with no existing strava link.
  const planned = await db.select().from(sessions)
    .where(and(eq(sessions.type, 'running'), eq(sessions.scheduledDate, epochDay)))
  const linked = await db.select().from(runSessions)
  const linkedSessionIds = new Set(linked.map(r => r.sessionId))
  const candidate = planned.find(s =>
    s.status !== 'skipped' &&
    s.status !== 'completed' &&
    !linkedSessionIds.has(s.id),
  )

  let parentSessionId: string
  let attachmentStatus: 'auto_pending' | 'orphan'
  if (candidate) {
    parentSessionId = candidate.id
    attachmentStatus = 'auto_pending'
  } else {
    parentSessionId = crypto.randomUUID()
    await db.insert(sessions).values({
      id: parentSessionId,
      type: 'running',
      scheduledDate: epochDay,
      timeSlot: null,
      blockType: 'fighter',
      status: 'completed',
      completedAt: new Date(act.start_date).getTime(),
      durationSec: act.moving_time,
      createdAt: nowSec,
    })
    attachmentStatus = 'orphan'
  }

  // Seed max_hr from Tanaka (208 - 0.7 × age) if profile has DOB but no
  // max_hr yet. Observed max from real runs will overwrite this. Without the
  // seed, zones never compute on the first run.
  const [profile] = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))
  let effectiveMaxHr = profile?.maxHr ?? null
  if (effectiveMaxHr == null && profile?.dob) {
    const tanaka = tanakaMaxHrFromDob(profile.dob)
    if (tanaka != null) {
      await db.update(userProfile)
        .set({ maxHr: tanaka, updatedAt: Date.now() })
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

  const runSessionId = crypto.randomUUID()
  const distanceKm = act.distance ? act.distance / 1000 : null
  const paceSecKm = distanceKm && act.moving_time
    ? Math.round(act.moving_time / distanceKm)
    : null

  await db.insert(runSessions).values({
    id: runSessionId,
    sessionId: parentSessionId,
    planWeek: null,
    runType: null,
    distanceKm,
    durationSec: act.moving_time,
    paceSecKm,
    isIndoor: act.trainer ? 1 : 0,
    avgHr: act.average_heartrate != null ? Math.round(act.average_heartrate) : null,
    maxHr: act.max_heartrate != null ? Math.round(act.max_heartrate) : null,
    zoneSeconds: zoneSeconds ? JSON.stringify(zoneSeconds) : null,
    elevationGainM: act.total_elevation_gain != null ? Math.round(act.total_elevation_gain) : null,
    source: 'strava',
    stravaActivityId: activityId,
    attachmentStatus,
  })

  if (act.splits_metric && act.splits_metric.length > 0) {
    for (const sp of act.splits_metric) {
      await db.insert(runSplits).values({
        id: crypto.randomUUID(),
        runSessionId,
        kmIndex: sp.split,
        durationSec: sp.moving_time,
        avgHr: sp.average_heartrate != null ? Math.round(sp.average_heartrate) : null,
        elevationGainM: sp.elevation_difference != null ? Math.round(sp.elevation_difference) : null,
      })
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
function tanakaMaxHrFromDob(dob: string): number | null {
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
function bucketZones(hr: number[], time: number[], maxHr: number): { z1: number; z2: number; z3: number; z4: number; z5: number } {
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
