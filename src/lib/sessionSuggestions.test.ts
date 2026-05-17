import { computeSuggestions, type WeekSession } from './sessionSuggestions'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function types(result: ReturnType<typeof computeSuggestions>): string[] {
  return result.suggestions.map(s => s.runCategory ? `${s.type}:${s.runCategory}` : s.type)
}

function testRoadBootcampOptionsStayOnRails() {
  const result = computeSuggestions({
    todayWellness: null,
    recentWellness: null,
    weekSessions: [],
    blockWeek: 1,
    blockType: 'road_bootcamp',
    targetDate: 20592,
    existingSessionsOnDate: [],
  })

  const keys = types(result)
  assert(keys.includes('strength'), 'road suggestions include strength')
  assert(keys.includes('foundation_run'), 'road suggestions include easy run')
  assert(keys.includes('running:progression'), 'road suggestions include quality run')
  assert(keys.includes('skip_rope'), 'road suggestions include rope')
  assert(keys.includes('mobility'), 'road suggestions include mobility')
  assert(!keys.includes('bag_work'), 'road suggestions do not include bag work')
  assert(!keys.includes('active_recovery'), 'road suggestions do not include reset')
  assert(!keys.includes('mt_class'), 'road suggestions do not include MT class')
}

function testRoadBootcampDeficitsUseRoadTargets() {
  const weekSessions: WeekSession[] = [
    { type: 'foundation_run', status: 'completed', scheduledDate: 20592, timeSlot: 'am' },
    { type: 'foundation_run', status: 'completed', scheduledDate: 20594, timeSlot: 'am' },
    { type: 'running', status: 'completed', scheduledDate: 20597, timeSlot: 'am', notes: 'progression' },
    { type: 'strength', status: 'completed', scheduledDate: 20593, timeSlot: 'am' },
    { type: 'strength', status: 'completed', scheduledDate: 20595, timeSlot: 'am' },
    { type: 'skip_rope', status: 'completed', scheduledDate: 20593, timeSlot: 'pm' },
  ]

  const result = computeSuggestions({
    todayWellness: null,
    recentWellness: null,
    weekSessions,
    blockWeek: 1,
    blockType: 'road_bootcamp',
    targetDate: 20597,
    existingSessionsOnDate: [],
  })

  const deficitKeys = result.deficits.map(d => d.type)
  assert(!deficitKeys.includes('foundation_run'), '2 easy runs satisfies road target')
  assert(!deficitKeys.includes('running:progression'), '1 quality run satisfies road target')
  assert(!deficitKeys.includes('strength'), '2 strength sessions satisfies road target')
  assert(deficitKeys.includes('skip_rope'), '1 rope session is behind road target')
  assert(deficitKeys.includes('mobility'), 'mobility remains daily')
}

function testLegacySuggestionsKeepLegacyOptions() {
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
  assert(keys.includes('bag_work'), 'legacy suggestions still include bag work')
  assert(keys.includes('active_recovery'), 'legacy suggestions still include reset')
}

testRoadBootcampOptionsStayOnRails()
testRoadBootcampDeficitsUseRoadTargets()
testLegacySuggestionsKeepLegacyOptions()

console.log('sessionSuggestions tests passed')
