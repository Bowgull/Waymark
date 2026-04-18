// Strava OAuth + token storage. Single-user app: one row in strava_tokens (id='default').
// Access tokens live 6 hours, refresh tokens are long-lived. Call getStravaAccessToken
// from ingestion code; it refreshes transparently when expired.

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { createDB } from '../../db/client'
import { stravaTokens } from '../../db/schema'

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

// Activity lifecycle events from Strava. Must respond 200 within 2s.
// Step 2 only logs; actual ingestion lands in step 4.
strava.post('/webhook', async (c) => {
  let body: unknown = null
  try {
    body = await c.req.json()
  } catch {
    // Empty or non-JSON body; Strava sometimes sends pings.
  }
  console.log('[strava-webhook]', JSON.stringify(body))
  return c.json({ ok: true })
})

// Safety-net poll. Called silently on Today page mount. Returns recent
// athlete activities from the last 48h so step 4 can fill gaps missed
// by the webhook. `alreadyLinked` is a placeholder until step 3 adds
// the strava_activity_id column to run_sessions.
strava.post('/poll-recent', async (c) => {
  const token = await getStravaAccessToken(c.env)
  if (!token) return c.json({ activities: [], connected: false })

  const after = Math.floor(Date.now() / 1000) - POLL_WINDOW_SEC
  const url = `${ACTIVITIES_URL}?after=${after}&per_page=30`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    console.error('[strava-poll] list failed', res.status, await res.text().catch(() => ''))
    return c.json({ activities: [], connected: true, error: `strava_${res.status}` })
  }

  const list = await res.json() as Array<{
    id: number
    name: string
    type: string
    sport_type?: string
    start_date_local: string
    distance?: number
    moving_time?: number
  }>

  const activities = list.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    sportType: a.sport_type ?? a.type,
    startDateLocal: a.start_date_local,
    distanceM: a.distance ?? null,
    movingTimeSec: a.moving_time ?? null,
    alreadyLinked: false,
  }))

  return c.json({ activities, connected: true })
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
