// Run: tsx src/features/weather/weatherData.test.ts
// The weather on Today (page 72): the stack's parsing, the strip's day, and
// the coach line that only shows when it matters. Toronto coordinates only.
import assert from 'node:assert/strict'
import { buildWeather, coachLine, ecSky, feelsLike, parseCity, wmoSky, type OpenMeteo } from './weatherData'
import { plannedMinute, plannedRuns, plannedWord } from './plannedHours'

process.env.TZ = 'America/Toronto'

// Thu 22 Oct 2026, 2:52 PM in Toronto (UTC-4).
const NOW = Date.parse('2026-10-22T18:52:00Z')
const OFF = -4 * 3600
const hoursFrom = (start: string, n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.parse(`${start}:00Z`) + i * 3600000); return d.toISOString().slice(0, 16) })

function om(over: Partial<{ temp: number[]; pop: number[]; mm: number[]; code: number[] }> = {}): OpenMeteo {
  const time = hoursFrom('2026-10-22T14:00', 12)
  const t = over.temp ?? [4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 0, 0]
  return {
    utc_offset_seconds: OFF,
    current: { time: '2026-10-22T14:45', temperature_2m: 3, weather_code: 3, wind_speed_10m: 12, is_day: 1, relative_humidity_2m: 80 },
    hourly: {
      time, temperature_2m: t,
      precipitation_probability: over.pop ?? [10, 10, 70, 90, 90, 60, 20, 10, 0, 0, 0, 0],
      precipitation: over.mm ?? [0, 0, 0.8, 1.6, 1.9, 0.7, 0, 0, 0, 0, 0, 0],
      weather_code: over.code ?? [3, 3, 61, 63, 63, 61, 3, 3, 2, 2, 2, 2],
      is_day: time.map((_, i) => (i < 4 ? 1 : 0)),
      relative_humidity_2m: time.map(() => 85), wind_speed_10m: time.map(() => 12),
    },
    daily: { time: ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'], temperature_2m_max: [6, 8, 11, 9, 7, 6, 2], temperature_2m_min: [-1, 0, 2, 4, 3, -2, -4], weather_code: [61, 2, 0, 3, 61, 2, 71] },
  }
}

// ─── Small parts ─────────────────────────────────────────────
assert.equal(wmoSky(0, true), 'sun'); assert.equal(wmoSky(0, false), 'moon'); assert.equal(wmoSky(63), 'rain'); assert.equal(wmoSky(73), 'snow'); assert.equal(wmoSky(95), 'storm')
assert.equal(ecSky(1), 'sun'); assert.equal(ecSky(30), 'moon'); assert.equal(ecSky(12), 'rain'); assert.equal(ecSky(17), 'snow'); assert.equal(ecSky(10), 'cloud')
assert.ok(Math.round(feelsLike(4, 80, 12).feels) <= 1, 'wind chill at 4° with 12 km/h')
assert.equal(feelsLike(15, 50, 20).feels, 15, 'mild: the air')
assert.ok((feelsLike(32, 60, 5).humidex ?? 0) >= 40, 'humidex on a hot humid day')

// ─── The day: now from the station, the hours nudged, rain from the radar ──
{
  const w = buildWeather({
    now: NOW, om: om(),
    station: { t: 4.4, rh: 80, at: NOW - 2 * 60000 },
    radar: [0, 0, 0, 0, 0, 0, 0, 0.3, 0.8, 1.4].map((mm, i) => ({ at: NOW + 6 * 60000 + i * 360000, mm })),
    radarNow: 0,
    city: null,
  })
  assert.equal(Math.round(w.now.t), 4, 'now: the station, not the model')
  assert.equal(w.hours.length, 8, 'the next 8 hours')
  assert.equal(new Date(w.hours[0].at).getHours(), 15, 'from the next hour (3 PM)')
  assert.ok(w.hours[0].t > 4, 'the first hour nudged up toward the station (model 4°, station +1.4°)')
  assert.equal(w.next, 'Rain at 3:40', 'the radar gives the time')
  assert.equal(w.rainInMin, 48)
  assert.match(w.rain, /^Rain 3:40 to \d{1,2} PM/)
  assert.equal(w.hi, 6); assert.equal(w.lo, -1)
  assert.equal(w.week.length, 7)
}

// ─── An old station reading is not "now"; no radar: the model's rain hour ──
{
  const w = buildWeather({ now: NOW, om: om(), station: { t: 9, rh: 50, at: NOW - 40 * 60000 } })
  assert.equal(w.now.t, 3, 'over 20 minutes old: the model')
  assert.equal(w.next, 'Rain at 4', 'the model hour')
}

// ─── A dry day ──
{
  const dry = om({ pop: Array(12).fill(0), mm: Array(12).fill(0), code: Array(12).fill(1) })
  const w = buildWeather({ now: NOW, om: dry })
  assert.equal(w.next, null)
  assert.equal(w.rain, 'No rain today')
  assert.equal(coachLine(w, [{ name: 'Run', at: Date.parse('2026-10-22T22:00:00Z') }], NOW), null, 'a plain day has no line')
}

// ─── EC's city forecast: high / low and the week ──
{
  const props = {
    forecastGroup: { forecasts: [
      { period: { textForecastName: { en: 'Tonight' } }, temperatures: { temperature: [{ class: { en: 'low' }, value: { en: -1 } }] }, abbreviatedForecast: { icon: { value: 12 }, textSummary: { en: 'Rain' } } },
      { period: { textForecastName: { en: 'Friday' } }, temperatures: { temperature: [{ class: { en: 'high' }, value: { en: 8 } }] }, abbreviatedForecast: { icon: { value: 2 }, textSummary: { en: 'A mix of sun and cloud' } } },
      { period: { textForecastName: { en: 'Friday night' } }, temperatures: { temperature: [{ class: { en: 'low' }, value: { en: 0 } }] }, abbreviatedForecast: { icon: { value: 30 }, textSummary: { en: 'Clear' } } },
      { period: { textForecastName: { en: 'Saturday' } }, temperatures: { temperature: [{ class: { en: 'high' }, value: { en: 11 } }] }, abbreviatedForecast: { icon: { value: 0 }, textSummary: { en: 'Sunny' } } },
    ] },
    warnings: [{ type: { en: 'warning' }, description: { en: 'Freezing rain warning in effect' } }, { type: { en: 'statement' }, description: { en: 'Special weather statement' } }],
  }
  const city = parseCity(props)
  assert.equal(city.periods.length, 4)
  assert.deepEqual(city.warnings, ['Freezing rain warning'], 'warnings only, "in effect" dropped')
  const w = buildWeather({ now: NOW, om: om(), city })
  assert.equal(w.lo, -1, "tonight's low from EC")
  assert.equal(w.hi, 6, "an evening read: today's high from the model")
  assert.deepEqual(w.week.map(d => [d.hi, d.lo, d.words]), [[6, -1, 'Rain'], [8, 0, 'A mix of sun and cloud'], [11, null, 'Sunny']])
  const line = coachLine(w, [{ name: 'Run', at: Date.parse('2026-10-22T22:00:00Z') }], NOW)
  assert.equal(line?.text, 'Freezing rain warning.', 'an EC warning: the weather only')
}

// ─── The coach line, at the run's hour ──
{
  const w = buildWeather({ now: NOW, om: om() })
  const six = Date.parse('2026-10-22T22:00:00Z') // 6 PM
  assert.equal(coachLine(w, [{ name: 'Run', at: six }], NOW)?.text, 'Run at 6 PM: 2° and rain.')
  const cold = om({ temp: Array(12).fill(-9), pop: Array(12).fill(0), mm: Array(12).fill(0), code: Array(12).fill(1) })
  cold.hourly.wind_speed_10m = Array(12).fill(30)
  assert.match(coachLine(buildWeather({ now: NOW, om: cold }), [{ name: 'Run', at: six }], NOW)?.text ?? '', /^Run at 6 PM: feels −\d+°\. Cover your face\.$/)
  const hot = om({ temp: Array(12).fill(31), pop: Array(12).fill(0), mm: Array(12).fill(0), code: Array(12).fill(1) })
  hot.hourly.relative_humidity_2m = Array(12).fill(70)
  assert.match(coachLine(buildWeather({ now: NOW, om: hot }), [{ name: 'Run', at: six }], NOW)?.text ?? '', /^Run at 6 PM: humidex \d+\. Go easy and take water\.$/)
  const soon = buildWeather({ now: NOW, om: om(), radar: [{ at: NOW + 20 * 60000, mm: 1 }] })
  assert.equal(coachLine(soon, [{ name: 'Run', at: NOW + 30 * 60000 }], NOW)?.text, 'Rain in about 20 min.')
  assert.equal(coachLine(w, [{ name: 'Run', at: NOW - 3 * 3600000 }], NOW), null, 'a run hour long gone says nothing')
  // °F follows Settings when it says miles
  assert.equal(coachLine(w, [{ name: 'Run', at: six }], NOW, 'F')?.text, 'Run at 6 PM: 36° and rain.')
  assert.equal(coachLine(w, [{ name: 'Run', at: six, when: 'Evening' }], NOW)?.text, 'Run this evening: 2° and rain.', 'no learned hour: no clock hour')
}

// ─── The planned hour: his usual start, a class's time, Settings' PM ──
{
  const hours = { usual: { foundation_run: { am: null, pm: 17 * 60 + 30 } }, pmStart: '18:00' }
  assert.equal(plannedMinute({ type: 'foundation_run', status: 'planned', timeSlot: 'pm' }, hours), 17 * 60 + 30)
  assert.equal(plannedMinute({ type: 'running', status: 'planned', timeSlot: 'pm' }, hours), 18 * 60, 'no usual start: the PM time')
  assert.equal(plannedMinute({ type: 'running', status: 'planned', timeSlot: 'am' }, hours), 7 * 60)
  assert.equal(plannedMinute({ type: 'mt_class', status: 'planned', timeSlot: 'pm', contextJson: JSON.stringify({ suggested: { time: '19:00' } }) }, hours), 19 * 60)
  const mid = Date.parse('2026-10-22T04:00:00Z')
  const runs = plannedRuns([{ type: 'foundation_run', status: 'planned', timeSlot: 'pm' }, { type: 'foundation_run', status: 'completed', timeSlot: 'am' }, { type: 'strength', status: 'planned', timeSlot: 'am' }], hours, mid)
  assert.equal(runs.length, 1, 'only runs still to do')
  assert.equal(new Date(runs[0].at).getHours(), 17)
  // Audit #16: no learned hour, no made-up clock hour: "Morning" / "Evening".
  assert.equal(plannedWord({ type: 'running', status: 'planned', timeSlot: 'am' }, hours), 'Morning')
  assert.equal(plannedWord({ type: 'running', status: 'planned', timeSlot: 'pm' }, hours), 'Evening')
  assert.equal(plannedWord({ type: 'foundation_run', status: 'planned', timeSlot: 'pm' }, hours), null, 'a learned hour is named')
  assert.equal(plannedWord({ type: 'running', status: 'planned', timeSlot: 'am' }, null), 'Morning')
  assert.equal(plannedRuns([{ type: 'running', status: 'planned', timeSlot: 'am' }], hours, mid)[0].when, 'Morning')
}

console.log('weather: ok')
