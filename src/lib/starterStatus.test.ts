import { hasStarterHrGraduation, profileIndicatesStarter } from './starterStatus'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

assert(profileIndicatesStarter('Long layoff from training.', null), 'detects deconditioned starter profile')

assert(hasStarterHrGraduation([
  { scheduledDate: 10, type: 'foundation_run', runType: 'zone2', avgHr: 144 },
  { scheduledDate: 9, type: 'foundation_run', runType: 'zone2', avgHr: 147 },
  { scheduledDate: 8, type: 'running', runType: 'easy', avgHr: 149 },
]), 'graduates after 3 recent easy runs under 150 bpm')

assert(!hasStarterHrGraduation([
  { scheduledDate: 10, type: 'foundation_run', runType: 'zone2', avgHr: 144 },
  { scheduledDate: 9, type: 'foundation_run', runType: 'zone2', avgHr: 151 },
  { scheduledDate: 8, type: 'running', runType: 'easy', avgHr: 149 },
]), 'does not graduate when one recent easy run is 150 bpm or higher')

assert(!hasStarterHrGraduation([
  { scheduledDate: 10, type: 'running', runType: 'tempo', avgHr: 144 },
  { scheduledDate: 9, type: 'running', runType: 'interval', avgHr: 147 },
  { scheduledDate: 8, type: 'running', runType: 'easy', avgHr: 149 },
]), 'does not graduate from quality runs')

console.log('starterStatus tests passed')
