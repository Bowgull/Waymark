// One plain line behind a tap on a run's name (page 93, approved 2026-10-25):
// four names only, Zone 2 Run, Tempo, Intervals and Run-Walk. The longer
// weekly run is a Zone 2 Run too (no long-run name). Pure.

const LINES: Readonly<Record<string, string>> = {
  'ZONE 2 RUN': 'Easy and steady. You can talk in full sentences the whole way.',
  TEMPO: 'Steady and hard. A few words, but no chatting. 15 to 20 minutes of it in the middle.',
  INTERVALS: 'Short hard runs with easy jogs between. Too hard to talk on the hard parts.',
  'RUN-WALK': 'Run a few minutes, walk one, again. It builds you to running the whole way.',
}

/** The line behind a run's name as its row shows it ("TEMPO"), or null (no line: the 5K test, a walk, anything else). */
export function runNameLine(name: string | null | undefined): string | null {
  return LINES[(name ?? '').trim().toUpperCase()] ?? null
}
