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
}

const REDIRECT_URI = 'https://waymark.bocas-joshua.workers.dev/api/strava/callback'
const SCOPES = 'read,activity:read_all'
const AUTH_URL = 'https://www.strava.com/oauth/authorize'
const TOKEN_URL = 'https://www.strava.com/oauth/token'
const DEAUTH_URL = 'https://www.strava.com/oauth/deauthorize'

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
