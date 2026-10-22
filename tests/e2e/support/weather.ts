import type { BrowserContext, Page, Route } from '@playwright/test'
import { testClockStart } from '../fixtures'

/**
 * The weather sources on Today (page 72), mocked: the phone's location is
 * Toronto rounded to 2 decimals (never anyone's address), and Open-Meteo, EC's
 * stations, radar nowcast and city page answer with a rainy afternoon and
 * evening. Nothing leaves the machine (the guard aborts any other host).
 */
export const TORONTO = { latitude: 43.65, longitude: -79.38 }

const HOSTS = /^https:\/\/(api\.open-meteo\.com|api\.weather\.gc\.ca|geo\.weather\.gc\.ca)\//

function pad(n: number) { return String(n).padStart(2, '0') }
function localIso(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }

/** Open-Meteo for today: 12 hours from the test clock's hour, rain from noon on. */
export function openMeteoBody(start = testClockStart()) {
  const off = -start.getTimezoneOffset() * 60
  const h0 = new Date(start); h0.setMinutes(0, 0, 0)
  const time: string[] = []
  for (let i = 0; i < 12; i++) time.push(localIso(new Date(h0.getTime() + i * 3600000)))
  const hour = (i: number) => new Date(h0.getTime() + i * 3600000).getHours()
  const wet = (i: number) => hour(i) >= 12
  const day0 = new Date(start); day0.setHours(12)
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(day0.getTime() + i * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` })
  return {
    utc_offset_seconds: off,
    current: { time: localIso(start), temperature_2m: 3, weather_code: 3, wind_speed_10m: 12, is_day: 1, relative_humidity_2m: 80 },
    hourly: {
      time,
      temperature_2m: time.map((_, i) => 4 - Math.floor(i / 3)),
      precipitation_probability: time.map((_, i) => (wet(i) ? 90 : 10)),
      precipitation: time.map((_, i) => (wet(i) ? 1.6 : 0)),
      weather_code: time.map((_, i) => (wet(i) ? 63 : 3)),
      is_day: time.map((_, i) => (hour(i) < 18 ? 1 : 0)),
      relative_humidity_2m: time.map(() => 85),
      wind_speed_10m: time.map(() => 12),
    },
    daily: { time: days, temperature_2m_max: [6, 8, 11, 9, 7, 6, 2], temperature_2m_min: [-1, 0, 2, 4, 3, -2, -4], precipitation_probability_max: [90, 20, 0, 30, 80, 20, 60], weather_code: [63, 2, 0, 3, 61, 2, 71] },
  }
}

function cityBody() {
  const p = (name: string, cls: 'high' | 'low', v: number, icon: number, words: string) => ({ period: { textForecastName: { en: name } }, temperatures: { temperature: [{ class: { en: cls }, value: { en: v } }] }, abbreviatedForecast: { icon: { value: icon }, textSummary: { en: words } } })
  return {
    properties: {
      forecastGroup: { forecasts: [
        p('Today', 'high', 6, 12, 'Rain'), p('Tonight', 'low', -1, 12, 'Rain'),
        p('Friday', 'high', 8, 2, 'Sun and cloud'), p('Friday night', 'low', 0, 30, 'Clear'),
        p('Saturday', 'high', 11, 0, 'Sunny'), p('Saturday night', 'low', 2, 30, 'Clear'),
        p('Sunday', 'high', 9, 10, 'Cloudy'), p('Sunday night', 'low', 4, 32, 'Cloudy periods'),
        p('Monday', 'high', 7, 12, 'Rain'), p('Monday night', 'low', 3, 12, 'Rain'),
        p('Tuesday', 'high', 6, 2, 'Sun and cloud'), p('Tuesday night', 'low', -2, 30, 'Clear'),
        p('Wednesday', 'high', 2, 16, 'Flurries'),
      ] },
      warnings: [],
    },
  }
}

async function answer(route: Route) {
  const url = route.request().url()
  const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  if (url.includes('api.open-meteo.com')) return json(openMeteoBody())
  if (url.includes('/swob-stations/')) return json({ features: [{ properties: { msc_id: '6158355' }, geometry: { coordinates: [-79.395, 43.665] } }] })
  if (url.includes('/swob-realtime/')) return json({ features: [{ properties: { air_temp: 4.4, rel_hum: 80, 'date_tm-value': new Date(testClockStart().getTime() - 2 * 60000).toISOString() } }] })
  if (url.includes('/citypageweather-realtime/items/')) return json(cityBody())
  if (url.includes('/citypageweather-realtime/items')) return json({ features: [{ id: 'on-143', geometry: { coordinates: [-79.4, 43.67] } }] })
  if (url.includes('request=GetCapabilities')) {
    const t0 = new Date(testClockStart().getTime() - 2 * 60000)
    t0.setUTCSeconds(0, 0)
    const iso = (d: Date) => d.toISOString().slice(0, 19) + 'Z'
    return route.fulfill({ status: 200, contentType: 'text/xml', headers: { 'access-control-allow-origin': '*' }, body: `<Dimension name="time" units="ISO8601">${iso(t0)}/${iso(new Date(t0.getTime() + 72 * 60000))}/PT6M</Dimension>` })
  }
  if (url.includes('request=GetFeatureInfo')) return json({ features: [{ properties: { value: 0 } }] })
  return route.abort('blockedbyclient')
}

/** The phone has a location and a signal: Toronto, a rainy evening. */
export async function mockWeather(page: Page, context: BrowserContext) {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation(TORONTO)
  await page.route(url => HOSTS.test(url.toString()), answer)
  // His usual hours: a PM run at 5 (the hour the coach line and the hour mark read).
  await page.route('**/api/coach/hours?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ usual: {}, pmStart: '17:00' }) }))
}

/** No location (never granted): the strip hides. */
export async function noLocation(context: BrowserContext) {
  await context.clearPermissions()
}
