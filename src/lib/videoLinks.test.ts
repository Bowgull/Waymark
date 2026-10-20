// Run: tsx src/lib/videoLinks.test.ts
// Page 60: the video button and its fallbacks, and the link check (a stand-in fetcher: no network).
import assert from 'node:assert/strict'

import { checkLink, hostOf, parseStart, searchUrl, secondLink, videoButton, withStart, youtubeId, type Fetcher } from './videoLinks'

assert.equal(hostOf('https://www.youtube.com/shorts/4n9HM7VabC0'), 'youtube')
assert.equal(hostOf('https://youtu.be/abc123'), 'youtube')
assert.equal(hostOf('https://www.tiktok.com/@fighttips/video/7189384658319183146'), 'tiktok')
assert.equal(youtubeId('https://www.youtube.com/watch?v=v-mQm_droHg'), 'v-mQm_droHg')
assert.equal(youtubeId('https://www.youtube.com/shorts/4n9HM7VabC0'), '4n9HM7VabC0')
assert.equal(parseStart('1:03'), 63)
assert.equal(parseStart(''), null)
assert.equal(withStart('https://www.youtube.com/watch?v=x1', 63), 'https://www.youtube.com/watch?v=x1&t=63')
assert.equal(withStart('https://www.youtube.com/shorts/x1', 30), 'https://www.youtube.com/shorts/x1?t=30')
assert.equal(withStart('https://www.youtube.com/watch?v=x1', null), 'https://www.youtube.com/watch?v=x1')
assert.equal(searchUrl('band row', 'E3 Rehab'), 'https://www.youtube.com/results?search_query=band%20row%20E3%20Rehab')

// live: WATCH ON YOUTUBE, then who and how long (page 60)
const squat = { url: 'https://www.youtube.com/shorts/4n9HM7VabC0', source: 'Squat University', title: 'How To Front Squat (HIGHER ELBOWS!)', length: '1:00', status: 'live', altUrl: 'https://www.youtube.com/watch?v=uQeCK1vfj4E', altSource: 'Squat University' }
assert.deepEqual(videoButton('Front Squat', squat), { label: 'WATCH ON YOUTUBE', href: squat.url, source: 'Squat University', detail: 'How To Front Squat (HIGHER ELBOWS!) · 1:00', note: null, kind: 'watch' })
assert.equal(videoButton('Teep', { url: 'https://www.tiktok.com/@x/video/1', status: 'live' })?.label, 'WATCH ON TIKTOK', 'the button names where it opens')
// dead: the backup first
assert.equal(videoButton('Front Squat', { ...squat, status: 'dead' })?.href, squat.altUrl)
// dead, no backup, a combo: its technique's video
const tech = { url: 'https://www.youtube.com/watch?v=t1', status: 'live', source: 'fightTIPS', title: 'Roundhouse' }
assert.equal(videoButton('jab cross body kick', { url: 'https://www.youtube.com/watch?v=c1', status: 'dead' }, tech)?.href, tech.url)
// dead and nothing else: a search, never a broken WATCH (page 60's Band Row)
const row = videoButton('Band Row', { url: 'https://www.youtube.com/watch?v=dead', status: 'dead', source: 'E3 Rehab' })
assert.deepEqual(row, { label: 'SEARCH ON YOUTUBE', href: searchUrl('band row', 'E3 Rehab'), source: null, detail: 'band row · E3 Rehab', note: 'Video gone. Showing a search.', kind: 'search' })
// no video at all (brisk walk): no button
assert.equal(videoButton('Brisk Walk', { url: null }), null)

// 0039 (2026-10-20): the start time opens YouTube where the move starts
assert.equal(videoButton('Bent Over Row', { url: 'https://www.youtube.com/watch?v=RQU8wZPbioA', startSec: 105, status: 'live' })?.href, 'https://www.youtube.com/watch?v=RQU8wZPbioA&t=105')
assert.equal(hostOf('https://vm.tiktok.com/ZMabc/'), 'tiktok')
assert.equal(hostOf('https://m.tiktok.com/@a/video/1'), 'tiktok')

// the second link: a TikTok under YouTube...
const d03 = { url: 'https://www.youtube.com/watch?v=u6p4YKrvTwg', startSec: 14, status: 'live', source: 'Tiger Muay Thai (Brad Riddell, with Dan Hooker)', tiktokUrl: 'https://www.tiktok.com/@trainor103/video/7468272181814873376' }
const d03b = videoButton('jab cross', d03)
assert.equal(d03b?.href, 'https://www.youtube.com/watch?v=u6p4YKrvTwg&t=14')
assert.deepEqual(secondLink(d03, d03b), { label: 'Also on TikTok', href: d03.tiktokUrl, who: 'trainor103' })
// ...not under a search, and not when it is the video the button opens
assert.equal(secondLink(d03, videoButton('jab cross', { ...d03, status: 'dead' })), null)
assert.equal(secondLink({ tiktokUrl: d03.url }, d03b), null, 'the same video (with its t=) is not shown twice')
// a TikTok as the MAIN video (main_source tiktok): WATCH ON TIKTOK, no t=, and YouTube as the quiet second
const tkMain = { url: 'https://www.tiktok.com/@trainor103/video/7211476819998969093', startSec: 4, status: 'live', source: 'Warrior Collective', tiktokUrl: 'https://www.youtube.com/watch?v=u6p4YKrvTwg' }
const tkb = videoButton('fake low kick', tkMain)
assert.equal(tkb?.label, 'WATCH ON TIKTOK')
assert.equal(tkb?.href, tkMain.url, 'TikTok links have no start time')
assert.deepEqual(secondLink(tkMain, tkb), { label: 'Also on YouTube', href: tkMain.tiktokUrl, who: null })
// a dead TikTok main video falls back like any other: the backup, the technique, then a YouTube search
assert.equal(videoButton('fake low kick', { ...tkMain, status: 'dead', altUrl: 'https://www.youtube.com/watch?v=bk' })?.href, 'https://www.youtube.com/watch?v=bk')
assert.equal(videoButton('fake low kick', { ...tkMain, status: 'dead' }, tech)?.href, tech.url)
const tkGone = videoButton('Fake Low Kick', { ...tkMain, status: 'dead' })
assert.equal(tkGone?.kind, 'search')
assert.equal(tkGone?.label, 'SEARCH ON YOUTUBE', 'never a broken WATCH ON TIKTOK')
assert.equal(secondLink(tkMain, tkGone), null)

async function main() {
  const answer = (status: number, body = ''): Fetcher => async () => ({ status, ok: status >= 200 && status < 300, text: async () => body })
  assert.equal(await checkLink('https://www.youtube.com/watch?v=a', answer(200)), 'live')
  assert.equal(await checkLink('https://www.youtube.com/watch?v=a', answer(404)), 'dead')
  assert.equal(await checkLink('https://www.youtube.com/watch?v=a', answer(401)), 'dead')
  assert.equal(await checkLink('https://www.youtube.com/watch?v=a', answer(429)), 'unchecked', 'rate-limited: try later')
  assert.equal(await checkLink('https://www.tiktok.com/@a/video/1', answer(200, '{"statusCode":0}')), 'live')
  assert.equal(await checkLink('https://www.tiktok.com/@a/video/1', answer(200, '{"statusCode":10204}')), 'dead')
  assert.equal(await checkLink('https://www.tiktok.com/@a/video/1', answer(200, '<html></html>')), 'unchecked')
  assert.equal(await checkLink('https://www.youtube.com/watch?v=a', async () => { throw new Error('offline') }), 'unchecked')
  let asked = ''
  await checkLink('https://www.youtube.com/watch?v=a', async u => { asked = u; return { status: 200, ok: true, text: async () => '' } })
  assert.ok(asked.startsWith('https://www.youtube.com/oembed?format=json&url='), 'YouTube is checked through oEmbed')
  console.log('videoLinks tests passed')
}

main().catch(e => { console.error(e); process.exit(1) })
