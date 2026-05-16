import { getRoadBootcampRunPrescription, getRoadBootcampTemplate, getRoadBootcampWeekLabel } from './roadBootcampTemplate'

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertArrayEqual<T>(actual: T[], expected: T[]) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function flattenWeek(weekNumber: number) {
  return Object.values(getRoadBootcampTemplate(weekNumber)).flat()
}

function testWeeklyRails() {
  for (let weekNumber = 1; weekNumber <= 8; weekNumber++) {
    const sessions = flattenWeek(weekNumber)
    const types = sessions.map((session) => session.type)

    assertEqual(types.filter((type) => type === 'foundation_run').length, 2, `week ${weekNumber} needs 2 easy runs`)
    assertEqual(types.filter((type) => type === 'running').length, 1, `week ${weekNumber} needs 1 quality run`)
    assertEqual(types.filter((type) => type === 'strength').length, 2, `week ${weekNumber} needs 2 strength sessions`)
    assertEqual(types.filter((type) => type === 'skip_rope').length, 2, `week ${weekNumber} needs 2 rope primers`)
    assertEqual(types.filter((type) => type === 'mobility').length, 7, `week ${weekNumber} needs daily mobility`)
    assertEqual(types.includes('mt_class'), false, `week ${weekNumber} must not assume MT class`)
    assertEqual(types.includes('bag_work'), false, `week ${weekNumber} must not assume heavy bag`)
  }
}

function testEightWeekLabels() {
  const labels = Array.from({ length: 8 }, (_, index) => getRoadBootcampWeekLabel(index + 1))
  assertArrayEqual(labels, [
    'Baseline and rhythm',
    'Add easy volume',
    'Controlled intensity',
    'Deload',
    'Build again',
    'Strongest week',
    'Density and consistency',
    'Consolidate',
  ])
}

function testRunPrescriptionsStayOnRoadRails() {
  const easy = getRoadBootcampRunPrescription(5, 'zone2')
  assertEqual(easy.runType, 'zone2')
  assertEqual(easy.targetDurSec, 2400)

  const quality = getRoadBootcampRunPrescription(6, 'progression')
  assertEqual(quality.runType, 'tempo')
  assertEqual(quality.targetDurSec, 1920)
}

function testHrCanSoftenRoadRun() {
  const quality = getRoadBootcampRunPrescription(6, 'progression', {
    z2RunsWithHr: 4,
    z2RunsAboveCeiling: 0,
    z2AvgHrLast4: 140,
    z2OverCeilingRate: 0,
    z2Compliance: 'on_target',
    driftBpm: 10,
    driftAssessment: 'clear_fatigue',
    lastAvgHr: 152,
    lastMaxHr: 178,
    lastRunDaysAgo: 1,
    runsInWindow: 5,
    runsWithHr: 5,
  })
  assertEqual(quality.runType, 'easy')
  assertEqual(quality.targetDurSec, 1800)

  const easy = getRoadBootcampRunPrescription(2, 'zone2', {
    z2RunsWithHr: 4,
    z2RunsAboveCeiling: 4,
    z2AvgHrLast4: 158,
    z2OverCeilingRate: 1,
    z2Compliance: 'over_paced',
    driftBpm: null,
    driftAssessment: 'insufficient_data',
    lastAvgHr: 160,
    lastMaxHr: 181,
    lastRunDaysAgo: 1,
    runsInWindow: 4,
    runsWithHr: 4,
  })
  assertEqual(easy.targetDesc.includes('145 bpm'), true)
}

testWeeklyRails()
testEightWeekLabels()
testRunPrescriptionsStayOnRoadRails()
testHrCanSoftenRoadRun()

console.log('roadBootcampTemplate tests passed')
