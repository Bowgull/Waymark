// The Naruto board's one line (page 46): "You watched about two episodes on that run." Pure.

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

export function narutoWatchedLine(watched: number): string {
  const n = Math.max(1, Math.round(watched))
  const count = n < WORDS.length ? WORDS[n] : String(n)
  return `You watched about ${count} episode${n === 1 ? '' : 's'} on that run.`
}
