// The web build's voice cues (page 76 §5): the bundled clips (public/cues,
// Piper "Poppy"), played one after another with HTMLAudio. On the phone the
// native recorder plays the same clips itself (locked, screen off, the show
// dipping under them); this player is only for the web and the e2e build.

const BASE = '/cues/'
const GAP_MS = 60

let queue: Promise<void> = Promise.resolve()

/** The clips last played (e2e reads window.__wmCueLog). */
function logCue(clips: string[]): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as { __wmCueLog?: string[][] }
  ;(w.__wmCueLog ??= []).push(clips)
}

function playOne(name: string): Promise<void> {
  return new Promise(resolve => {
    try {
      const a = new Audio(`${BASE}${name}.m4a`)
      const done = () => resolve()
      a.addEventListener('ended', done, { once: true })
      a.addEventListener('error', done, { once: true })
      // Autoplay refused (no tap yet) or no audio device: go on quietly.
      a.play().catch(done)
      // A clip never takes long; never let one hang the queue.
      setTimeout(done, 4000)
    } catch {
      resolve()
    }
  })
}

/** Play a cue's clips in order (a chime, then the words). Cues queue; none overlaps another. */
export function playClips(clips: string[]): Promise<void> {
  logCue(clips)
  queue = queue.then(async () => {
    for (const c of clips) {
      await playOne(c)
      await new Promise(r => setTimeout(r, GAP_MS))
    }
  })
  return queue
}
