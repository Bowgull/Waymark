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
  // 0039: a TikTok may be the main video; the check reads its page, a dead one gets a YouTube search to review
  await db.insert(exercises).values({ id: 'ex-test-tiktok', name: 'Test TikTok Move', category: 'strength', formVideoUrl: 'https://www.tiktok.com/@coach/video/123', videoSource: 'fightTIPS', createdAt: 1 })

  const calls: string[] = []
  const fetcher: Fetcher = async url => {
    calls.push(url)
    // the test's TikTok is gone; the Library's own TikTok mains (0041) are live
    if (url.includes('tiktok.com')) return { status: 200, ok: true, text: async () => (url.includes('@coach/video/123') ? '{"statusCode":10204}' : '{"statusCode":0}') }
    const dead = url.includes('deadone') || url.includes('deadtwo')
    return { status: dead ? 404 : 200, ok: !dead, text: async () => '' }
  }
  const out = await runLinkCheck(db, fetcher, NOW + 60, { sleep: async () => {} })
  assert.deepEqual(out, { checked: 4, dead: 3, reviews: 3 })
  assert.ok(calls.filter(c => !c.includes('tiktok.com')).every(c => c.startsWith('https://www.youtube.com/oembed')), 'YouTube through oEmbed, through the stand-in')
  assert.ok(calls.includes('https://www.tiktok.com/@coach/video/123'), 'a TikTok main video: its page is checked')
  const [tk] = await db.select().from(exercises).where(eq(exercises.id, 'ex-test-tiktok'))
  assert.equal(tk.videoStatus, 'dead')
  assert.equal(tk.formVideoUrl, 'https://www.tiktok.com/@coach/video/123', 'never replaced by itself')

  const [d] = await db.select().from(exercises).where(eq(exercises.id, 'ex-test-dead'))
  assert.equal(d.videoStatus, 'dead')
  assert.equal(d.formVideoUrl, 'https://www.youtube.com/watch?v=deadone', 'never replaced by itself')
  const [a] = await db.select().from(exercises).where(eq(exercises.id, 'ex-test-alt'))
  assert.equal(a.altVideoStatus, 'live')
  const [l] = await db.select().from(exercises).where(eq(exercises.id, 'ex-test-live'))
  assert.equal(l.videoStatus, 'live')

  const reviews = await pendingReviews(db)
  assert.equal(reviews.length, 3)
  assert.match(reviews.find(r => r.itemId === 'ex-test-tiktok')!.proposal!, /^search: https:\/\/www\.youtube\.com\/results\?search_query=Test%20TikTok%20Move%20fightTIPS$/)
  assert.equal(reviews.find(r => r.itemId === 'ex-test-alt')?.proposal, 'https://www.youtube.com/watch?v=backup', 'the backup, when it is live')
  assert.match(reviews.find(r => r.itemId === 'ex-test-dead')!.proposal!, /^search: https:\/\/www\.youtube\.com\/results\?search_query=Test%20Dead%20Move%20E3%20Rehab$/)

  // a week later it is checked again; the same dead link is not proposed twice
  const again = await runLinkCheck(db, fetcher, NOW + 60 + RECHECK_AFTER_SEC + 1, { sleep: async () => {}, limit: 500 })
  assert.ok(again.checked >= 4)
  assert.equal((await db.select().from(videoReviews)).length, 3)
  // nothing due: nothing checked
  assert.equal((await runLinkCheck(db, fetcher, NOW + 60 + RECHECK_AFTER_SEC + 2, { sleep: async () => {} })).checked, 0)
  console.log('linkHealth tests passed')
}

main().catch(e => { console.error(e); process.exit(1) })
