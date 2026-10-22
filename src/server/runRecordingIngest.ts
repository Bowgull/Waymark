// A run Waymark recorded itself (page 74), uploaded once through the outbox:
// POST /api/run-sessions/:id/recording. The server fills the run's columns the
// way the Strava ingest did, with the same hrZones functions (bucketZones for
// zone_seconds over moving time, sustainedMaxHr + maxHrAfterRun for the max-HR
// bump, the Tanaka seed when there is no max yet), so hrAnalysis, the weekly
// zones, the aerobic base and the brain's run model read it unchanged.
// source = 'waymark', attachment 'confirmed' (recorded inside the planned run).
// Idempotent: the route sits behind the Idempotency-Key middleware, and a
// second upload of the same recording rewrites the same values and splits.

import { eq } from 'drizzle-orm'

import type { createDB } from '../db/client'
import { runSessions, runSplits, userProfile } from '../db/schema'
import { ageFromDob } from '../lib/blockZero/running'
import { bucketZones, maxHrAfterRun, sustainedMaxHr, type ZoneSeconds } from '../lib/hrZones'
import { recordingSplits, summarizeRecording, zoneStreams, type RunRecording } from '../lib/runRecording'
import { assessRunCompletion } from '../lib/trainingReality'
import { tanakaMaxHrFromDob } from './routes/strava'

type DB = ReturnType<typeof createDB>

export interface IngestRecordingResult {
  runSessionId: string
  distanceKm: number | null
  durationSec: number
  avgHr: number | null
  maxHr: number | null
  zoneSeconds: ZoneSeconds | null
  maxHrBumped: { from: number | null; to: number } | null
}

export async function ingestRecording(db: DB, runSessionId: string, rec: RunRecording, nowSec: number): Promise<IngestRecordingResult | null> {
  const [run] = await db.select().from(runSessions).where(eq(runSessions.id, runSessionId))
  if (!run) return null
  const sum = summarizeRecording(rec)

  // Max HR for the zones: the profile's, else the Tanaka seed from the birth date (as the Strava ingest).
  const [profile] = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))
  let effectiveMaxHr = profile?.maxHr ?? null
  if (effectiveMaxHr == null && profile?.dob) {
    const tanaka = tanakaMaxHrFromDob(profile.dob)
    if (tanaka != null) {
      await db.update(userProfile).set({ maxHr: tanaka, updatedAt: nowSec }).where(eq(userProfile.id, 'default'))
      effectiveMaxHr = tanaka
    }
  }

  const streams = zoneStreams(rec)
  const hasHr = streams.hr.length > 0
  const zoneSeconds = effectiveMaxHr && hasHr ? bucketZones(streams.hr, streams.time, effectiveMaxHr, streams.moving) : null
  const reality = assessRunCompletion({ plannedDurationSec: run.plannedDurationSec, completedDurationSec: sum.durationSec })

  await db.update(runSessions).set({
    durationSec: sum.durationSec,
    ...(sum.distanceKm != null ? { distanceKm: sum.distanceKm, paceSecKm: sum.paceSecKm } : {}),
    isIndoor: rec.outdoor ? 0 : 1,
    ...(sum.avgHr != null ? { avgHr: sum.avgHr } : {}),
    ...(sum.maxHr != null ? { maxHr: sum.maxHr } : {}),
    zoneSeconds: zoneSeconds ? JSON.stringify(zoneSeconds) : null,
    completionRatio: reality.completionRatio,
    completionStatus: reality.completionStatus,
    source: 'waymark',
    attachmentStatus: 'confirmed',
    activityStartAt: Math.round(rec.startedAt),
    activityEndAt: Math.round(rec.endedAt),
  }).where(eq(runSessions.id, runSessionId))

  // Splits: replaced whole, so a replay never doubles them. D1 binds at most 100 params: 15 rows of 6.
  await db.delete(runSplits).where(eq(runSplits.runSessionId, runSessionId))
  const rows = recordingSplits(rec).map(sp => ({ id: crypto.randomUUID(), runSessionId, kmIndex: sp.kmIndex, durationSec: sp.durationSec, avgHr: sp.avgHr, elevationGainM: null }))
  for (let i = 0; i < rows.length; i += 15) await db.insert(runSplits).values(rows.slice(i, i + 15))

  // Max HR moves only on a sustained value under the age cap (one spike can't shift the zones).
  let maxHrBumped: IngestRecordingResult['maxHrBumped'] = null
  if (hasHr && profile) {
    const current = effectiveMaxHr ?? profile.maxHr ?? null
    const next = maxHrAfterRun({
      currentMaxHr: current,
      sustainedHr: sustainedMaxHr(streams.hr, streams.time, { moving: streams.moving }),
      ageYears: ageFromDob(profile.dob ?? null, Math.floor(nowSec / 86400)),
    })
    if (next != null) {
      await db.update(userProfile).set({ maxHr: next, updatedAt: nowSec }).where(eq(userProfile.id, 'default'))
      maxHrBumped = { from: current, to: next }
    }
  }

  return { runSessionId, distanceKm: sum.distanceKm, durationSec: sum.durationSec, avgHr: sum.avgHr, maxHr: sum.maxHr, zoneSeconds, maxHrBumped }
}
