import { computeSuggestions } from './sessionSuggestions'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function types(result: ReturnType<typeof computeSuggestions>): string[] {
  return result.suggestions.map(s => s.runCategory ? `${s.type}:${s.runCategory}` : s.type)
}

function testSuggestionsIncludeStandardOptions() {
  const result = computeSuggestions({
    todayWellness: null,
    recentWellness: null,
    weekSessions: [],
    blockWeek: 1,
    blockType: 'block_zero',
    targetDate: 20592,
    existingSessionsOnDate: [],
  })

  const keys = types(result)
  assert(keys.includes('bag_work'), 'suggestions include bag work')
  assert(keys.includes('active_recovery'), 'suggestions include reset')
}

testSuggestionsIncludeStandardOptions()

// Herb on the 0-9 check-in scale: 6+ is a substance-load day, 5 is not.
function testHerbScale() {
  const at = (herbScale: number) => computeSuggestions({
    todayWellness: { sleepHours: 7.5, soreness: 2, herbScale, alcoholScale: 0 },
    recentWellness: null,
    weekSessions: [],
    blockWeek: 1,
    blockType: 'block_zero',
    targetDate: 20592,
    existingSessionsOnDate: [],
  }).flags
  assert(at(6).includes('Substance load (herb 6/9)'), 'herb 6 of 9 flags a substance load, in scale words')
  assert(!at(5).some(f => f.startsWith('Substance load')), 'herb 5 of 9 is not a substance load')
}

testHerbScale()

console.log('sessionSuggestions tests passed')

// dead end #19: Block Zero's names on the add board
{
  const { withBlockLabels: wbl, allBoardRows: rows } = await import('./sessionSuggestions')
  const bz = wbl(rows(), 'block_zero')
  if (bz.find(r => r.type === 'foundation_run')?.label !== 'Run-Walk') throw new Error('Block Zero: the run-walk reads Run-Walk')
  if (bz.find(r => r.type === 'running')?.label !== 'Easy Run') throw new Error('Block Zero: the run reads Easy Run')
  if (wbl(rows(), 'fighter').find(r => r.type === 'foundation_run')?.label !== 'Zone 2') throw new Error('Fighter keeps Zone 2')
  console.log('ok: Block Zero board labels')
}
