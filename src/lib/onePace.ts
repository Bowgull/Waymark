// Released One Pace arcs, in chronological order.
// Verified 2026-04-18 against One Pace's current releases (through Egghead).
export const ONE_PACE_ARCS = [
  'Romance Dawn',
  'Orange Town',
  'Syrup Village',
  'Baratie',
  'Arlong Park',
  'Loguetown',
  'Reverse Mountain',
  'Whisky Peak',
  'Little Garden',
  'Drum Island',
  'Arabasta',
  'Jaya',
  'Skypiea',
  'Long Ring Long Land',
  'Water 7',
  'Enies Lobby',
  'Post Enies Lobby',
  'Thriller Bark',
  'Sabaody',
  'Amazon Lily',
  'Impel Down',
  'Marineford',
  'Post War',
  'Return to Sabaody',
  'Fish-Man Island',
  'Punk Hazard',
  'Dressrosa',
  'Zou',
  'Whole Cake Island',
  'Reverie',
  'Wano',
  'Egghead',
] as const

export type OnePaceArc = (typeof ONE_PACE_ARCS)[number]

/** One Pace: the indoor-run watch link. */
export const ONEPACE_URL = 'https://onepace.net'

/**
 * Naruto (the original series) on Netflix. Title id 70205012 checked
 * 2026-10-18: netflix.com/title/70205012 resolves to "Naruto" (2006, 9
 * seasons, Shippuden listed separately) and is served in several regions.
 * 80097171 resolved to the same show; device check which one the Canadian
 * catalogue opens in the Netflix app.
 */
export const NARUTO_NETFLIX_URL = 'https://www.netflix.com/title/70205012'

export type IndoorMedia = 'one_pace' | 'naruto'
