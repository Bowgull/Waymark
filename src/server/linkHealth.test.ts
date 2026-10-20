// Run: tsx src/server/linkHealth.test.ts
// Page 60 item 12 on a real (in-memory) database with every migration (0038 included):
// the nightly check marks dead links, proposes a replacement for review and never applies it.
// A stand-in fetcher: no network.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'

import { combos, exercises, runTypes, techniques, videoReviews } from '../db/schema'
import type { Fetcher } from '../lib/videoLinks'
import { RECHECK_AFTER_SEC, pendingReviews, runLinkCheck } from './linkHealth'
import { testDb } from './testDb'

async function main() {
  const db = testDb()
  const NOW = 1_800_000_000
  // the migration's content is there: techniques, run types, combo videos, the tidy-ups
  const tech = await db.select().from(techniques)
  assert.equal(tech.length, 23)
  assert.ok(tech.some(t => t.id === 'tech-switch-kick' && JSON.parse(t.aliases).includes('Left Kick')), '"Left Kick" is the switch kick')
  assert.equal((await db.select().from(runTypes)).length, 7)

  // a small, known set to check: everything else checked just now
  for (const t of [exercises, combos, techniques, runTypes] as const) await db.update(t).set({ videoCheckedAt: NOW })
  await db.insert(exercises).values({ id: 'ex-test-dead', name: 'Test Dead Move', category: 'strength', formVideoUrl: 'https://www.youtube.com/watch?v=deadone', videoSource: 'E3 Rehab', createdAt: 1 })
  await db.insert(exercises).values({ id: 'ex-test-alt', name: 'Test Alt Move', category: 'strength', formVideoUrl: 'https://www.youtube.com/watch?v=deadtwo', altVideoUrl: 'https://www.youtube.com/watch?v=backup', videoSource: 'Squat University', createdAt: 1 })
  await db.insert(exercises).values({ id: 'ex-test-live', name: 'Test Live Move', category: 'strength', formVideoUrl: 'https://www.youtube.com/watch?v=fine', createdAt: 1 })

  const calls: string[] = []
  const fetcher: Fetcher = async url => {
    calls.push(url)
    const dead = url.includes('deadone') || url.includes('deadtwo')
    return { status: dead ? 404 : 200, ok: !dead, text: async () => '' }
  }
  const out = await runLinkCheck(db, fetcher, NOW + 60, { sleep: async () => {} })
  assert.deepEqual(out, { checked: 3, dead: 2, reviews: 2 })
  assert.ok(calls.every(c => c.startsWith('https://www.youtube.com/oembed')), 'oEmbed only, through the stand-in')

  const [d] = await db.select().from(exercises).where(eq(exercises.id, 'ex-test-dead'))
  assert.equal(d.videoStatus, 'dead')
  assert.equal(d.formVideoUrl, 'https://www.youtube.com/watch?v=deadone', 'never replaced by itself')
  const [a] = await db.select().from(exercises).where(eq(exercises.id, 'ex-test-alt'))
  assert.equal(a.altVideoStatus, 'live')
  const [l] = await db.select().from(exercises).where(eq(exercises.id, 'ex-test-live'))
  assert.equal(l.videoStatus, 'live')

  const reviews = await pendingReviews(db)
  assert.equal(reviews.length, 2)
  assert.equal(reviews.find(r => r.itemId === 'ex-test-alt')?.proposal, 'https://www.youtube.com/watch?v=backup', 'the backup, when it is live')
  assert.match(reviews.find(r => r.itemId === 'ex-test-dead')!.proposal!, /^search: https:\/\/www\.youtube\.com\/results\?search_query=Test%20Dead%20Move%20E3%20Rehab$/)

  // a week later it is checked again; the same dead link is not proposed twice
  const again = await runLinkCheck(db, fetcher, NOW + 60 + RECHECK_AFTER_SEC + 1, { sleep: async () => {}, limit: 500 })
  assert.ok(again.checked >= 3)
  assert.equal((await db.select().from(videoReviews)).length, 2)
  // nothing due: nothing checked
  assert.equal((await runLinkCheck(db, fetcher, NOW + 60 + RECHECK_AFTER_SEC + 2, { sleep: async () => {} })).checked, 0)
  console.log('linkHealth tests passed')
}

main().catch(e => { console.error(e); process.exit(1) })
