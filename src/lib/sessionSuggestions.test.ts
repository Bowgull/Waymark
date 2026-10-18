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

console.log('sessionSuggestions tests passed')
