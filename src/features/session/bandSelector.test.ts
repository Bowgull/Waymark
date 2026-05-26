import { BAND_COLORS, getBandSelectionLine } from './bandSelector'

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`)
  }
}

function testBandOrderMatchesHapbearProgression() {
  assertEqual(BAND_COLORS.map(band => band.value).join(','), 'yellow,orange,red,blue,purple')
}

function testPrescribedBandCopyIsMinimal() {
  assertEqual(getBandSelectionLine('red', 'red'), 'Red. Working band.')
}

function testAdjustedBandCopyIsMinimal() {
  assertEqual(getBandSelectionLine('blue', 'red'), 'Blue. Adjusted.')
}

function testEmptyBandCopy() {
  assertEqual(getBandSelectionLine(null, 'red'), 'Choose band.')
}

testBandOrderMatchesHapbearProgression()
testPrescribedBandCopyIsMinimal()
testAdjustedBandCopyIsMinimal()
testEmptyBandCopy()

console.log('bandSelector tests passed')
