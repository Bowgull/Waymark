import { buildLedgerInsightPrompt } from './ledgerInsightsAI'

function assertIncludes(value: string, needle: string): void {
  if (!value.includes(needle)) {
    throw new Error(`Expected prompt to include: ${needle}`)
  }
}

const prompt = buildLedgerInsightPrompt({
  dashboard: null,
  consistency: null,
  prs: [],
  correlations: [],
  runSummary: { totalRuns: 2, totalDistanceKm: 10.7, avgPaceSecKm: 391, bestPaceSecKm: 370 },
  roadBootcampMetrics: null,
  categoryCompletion: null,
  recentRunEvidence: [
    {
      date: '2026-05-16',
      runType: 'zone2',
      source: 'strava',
      distanceKm: 2.66,
      paceSecKm: 408,
      avgHr: 143,
      maxHr: 160,
      elevationGainM: 6,
      zoneSeconds: '{"z2":900,"z3":120}',
      reviewFlag: 'intensity_mismatch',
    },
  ],
})

assertIncludes(prompt, 'Recent run evidence:')
assertIncludes(prompt, '2026-05-16 zone2 from Strava: 2.66 km, 6:48/km, avg HR 143, max 160, elevation 6 m, zones {"z2":900,"z3":120}, flag intensity_mismatch.')
assertIncludes(prompt, 'Use recent run evidence only for bounded patterns.')

console.log('ledgerInsightsAI tests passed')
