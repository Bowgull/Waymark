// The weather on Today (page 72, approved 2026-10-22): the data stack as
// researched on the page, all free, no keys, fetched from the phone.
//
// - Now: the nearest Environment Canada station within 10 km (SWOB, about
//   every minute), feels-like from its temperature and humidity with the
//   model's wind (EC wind chill and humidex). No station near enough, or its
//   reading over 20 minutes old: the model's "now".
// - When the rain comes: EC's radar nowcast at this point for the next hour
//   (6-minute steps), then the model.
// - The hours: Open-Meteo's best model for the spot (HRRR around Toronto,
//   Canada's HRDPS elsewhere), the first hours nudged to the station.
// - High / low, the week and warnings: EC's city forecast.
//
// None of it is named on the phone. Pure parsing plus the fetchers; relative
// imports only so the tests run it under node.

export type Sky = 'sun' | 'moon' | 'part' | 'partn' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog'

export interface WxHour {
  /** Epoch ms of the hour. */
  at: number
  sky: Sky
  /** °C */
  t: number
  pop: number
  mm: number
  code: number
  /** Feels-like °C (EC wind chill or humidex), and the humidex when it applies. */
  feels: number
  humidex: number | null
}

export interface WxDay {
  /** Epoch ms at local noon. */
  at: number
  sky: Sky
  hi: number | null
  lo: number | null
  words: string
}

export interface Weather {
  now: { t: number; feels: number; sky: Sky; words: string }
  /** "Rain at 3:40" / "Raining now", or null (no rain coming). */
  next: string | null
  /** Radar: rain starts within the hour, minutes from now (null: none seen). */
  rainInMin: number | null
  /** The next 8 hours. */
  hours: WxHour[]
  hi: number | null
  lo: number | null
  /** One line for when the rain comes ("Rain 3:40 to 7 PM, heaviest at 6"). */
  rain: string
  rainSky: Sky
  week: WxDay[]
  /** EC warnings in force (their titles). */
  warnings: string[]
  /** When it was read (epoch ms); never shown. */
  at: number
}

// ─── Small helpers ─────────────────────────────────────────────

export const SKY_WORDS: Readonly<Record<Sky, string>> = { sun: 'Clear', moon: 'Clear', part: 'Sun and cloud', partn: 'Some cloud', cloud: 'Cloudy', rain: 'Rain', snow: 'Snow', storm: 'Thunder', fog: 'Fog' }

/** WMO weather code (Open-Meteo) to a pixel sky. */
export function wmoSky(code: number, day = true): Sky {
  if (code <= 1) return day ? 'sun' : 'moon'
  if (code === 2) return day ? 'part' : 'partn'
  if (code === 3) return 'cloud'
  if (code <= 48) return 'fog'
  if (code >= 95) return 'storm'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  return 'rain'
}

/** EC's forecast icon code to a pixel sky. */
export function ecSky(icon: number): Sky {
  if (icon === 0 || icon === 1) return 'sun'
  if (icon === 30 || icon === 31) return 'moon'
  if (icon === 2 || icon === 3 || icon === 4 || icon === 5 || icon === 22) return 'part'
  if (icon === 32 || icon === 33 || icon === 34 || icon === 35) return 'partn'
  if (icon === 10) return 'cloud'
  if ((icon >= 23 && icon <= 24) || icon === 44) return 'fog'
  if (icon === 9 || icon === 19 || icon === 39 || icon === 46 || icon === 47) return 'storm'
  if (icon === 8 || (icon >= 16 && icon <= 18) || icon === 25 || icon === 26 || icon === 38 || icon === 40) return 'snow'
  if ((icon >= 6 && icon <= 7) || (icon >= 11 && icon <= 15) || icon === 27 || icon === 28 || icon === 36 || icon === 37) return 'rain'
  return 'cloud'
}

/** Feels-like °C: EC's wind chill (10° or colder, wind over 4.8 km/h), else humidex (20° or warmer), else the air. */
export function feelsLike(t: number, rh: number | null, windKmh: number | null): { feels: number; humidex: number | null } {
  const v = windKmh ?? 0
  if (t <= 10 && v > 4.8) return { feels: 13.12 + 0.6215 * t - 11.37 * v ** 0.16 + 0.3965 * t * v ** 0.16, humidex: null }
  if (t >= 20 && rh != null && rh > 0) {
    const a = 17.27
    const g = (a * t) / (237.7 + t) + Math.log(rh / 100)
    const td = (237.7 * g) / (a - g)
    const e = 6.11 * Math.exp(5417.753 * (1 / 273.16 - 1 / (273.15 + td)))
    const h = t + 0.5555 * (e - 10)
    if (h > t + 1) return { feels: h, humidex: h }
  }
  return { feels: t, humidex: null }
}

const dist = (a: number, b: number, c: number, d: number) => Math.hypot((c - a) * 111.2, (d - b) * 111.2 * Math.cos((a * Math.PI) / 180))

/** "3:40" (the phone's local time, no AM / PM). */
export function clock(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "6 PM" */
export function hourWord(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
}

/** "6P" for the hours row. */
export function hourShort(ms: number): string {
  const h = new Date(ms).getHours()
  return `${h % 12 || 12}${h < 12 ? 'A' : 'P'}`
}

/** Celsius to the unit shown, rounded. */
export function inUnit(c: number, unit: 'C' | 'F'): number {
  const n = Math.round(unit === 'F' ? c * 9 / 5 + 32 : c)
  return n === 0 ? 0 : n
}

/** A temperature for prose: the unit's number with a real minus ("−18"). */
export function degText(c: number, unit: 'C' | 'F'): string {
  const n = inUnit(c, unit)
  return n < 0 ? `−${-n}` : String(n)
}

// ─── Parsing (pure) ────────────────────────────────────────────

/** The parts of Open-Meteo's answer the strip reads. */
export interface OpenMeteo {
  utc_offset_seconds: number
  current: { time: string; temperature_2m: number; weather_code: number; wind_speed_10m: number; is_day: number; relative_humidity_2m?: number }
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: Array<number | null>; precipitation: number[]; weather_code: number[]; is_day: number[]; relative_humidity_2m?: number[]; wind_speed_10m?: number[] }
  daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max?: Array<number | null>; weather_code: number[] }
}

/** A local time string from Open-Meteo ("2026-10-22T15:00") as epoch ms. */
export function omTime(local: string, offsetSec: number): number {
  return Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`) - offsetSec * 1000
}

export interface Station { t: number; rh: number | null; at: number }

export interface CityPeriod { name: string; icon: number | null; words: string; high: number | null; low: number | null }
export interface City { periods: CityPeriod[]; warnings: string[] }

type Loc = { en?: unknown } | undefined
const en = (v: Loc) => (v && typeof v === 'object' && 'en' in v ? v.en : undefined)

/** EC's city page (citypageweather-realtime item properties) as periods and warnings. */
export function parseCity(props: Record<string, unknown>): City {
  const fg = props.forecastGroup as { forecasts?: Array<Record<string, unknown>> } | undefined
  const periods: CityPeriod[] = (fg?.forecasts ?? []).map(f => {
    const period = f.period as { textForecastName?: Loc } | undefined
    const temps = (f.temperatures as { temperature?: Array<{ class?: Loc; value?: Loc }> } | undefined)?.temperature ?? []
    const t = (cls: string) => { const x = temps.find(v => en(v.class) === cls); const n = Number(en(x?.value)); return x && Number.isFinite(n) ? n : null }
    const ab = f.abbreviatedForecast as { icon?: { value?: unknown }; textSummary?: Loc } | undefined
    const icon = Number(ab?.icon?.value)
    return { name: String(en(period?.textForecastName) ?? ''), icon: Number.isFinite(icon) ? icon : null, words: String(en(ab?.textSummary) ?? ''), high: t('high'), low: t('low') }
  })
  const warnings = (Array.isArray(props.warnings) ? props.warnings as Array<Record<string, unknown>> : [])
    .filter(w => /warning/i.test(String(en(w.type as Loc) ?? w.type ?? '')))
    .map(w => String(en(w.description as Loc) ?? en(w.type as Loc) ?? 'A weather warning').replace(/\s+in effect$/i, '').trim())
    .filter(Boolean)
  return { periods, warnings }
}

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export function dayName(ms: number): string {
  return DAY3[new Date(ms).getDay()]
}

/**
 * Build the strip's day from the sources that answered (only Open-Meteo is
 * required): now, the next 8 hours, when the rain comes, high and low, the week.
 */
export function buildWeather(input: { now: number; om: OpenMeteo; station?: Station | null; radar?: Array<{ at: number; mm: number }> | null; radarNow?: number | null; city?: City | null }): Weather {
  const { now, om } = input
  const off = om.utc_offset_seconds
  const st = input.station && now - input.station.at <= 20 * 60000 ? input.station : null
  const c = om.current
  const tNow = st ? st.t : c.temperature_2m
  const nudge = st ? st.t - c.temperature_2m : 0
  const h = om.hourly
  const all = h.time.map((t, i) => ({ at: omTime(t, off), i }))
  const hours: WxHour[] = all.filter(x => x.at > now - 3600000).slice(1, 9).map((x, k) => {
    const i = x.i
    const t = h.temperature_2m[i] + nudge * Math.max(0, 1 - (k + 1) / 4)
    const f = feelsLike(t, h.relative_humidity_2m?.[i] ?? null, h.wind_speed_10m?.[i] ?? null)
    return { at: x.at, sky: wmoSky(h.weather_code[i], h.is_day[i] === 1), t, pop: h.precipitation_probability[i] ?? 0, mm: h.precipitation[i] ?? 0, code: h.weather_code[i], feels: f.feels, humidex: f.humidex }
  })
  const wetNow = (input.radarNow ?? 0) >= 0.2
  const radar = (input.radar ?? []).filter(r => r.at > now - 180000)
  const firstRadar = radar.find(r => r.mm >= 0.2) ?? null
  const wetHour = hours.find(x => x.pop >= 50 || x.mm >= 0.5) ?? null
  const skyNow: Sky = wetNow ? 'rain' : wmoSky(c.weather_code, c.is_day === 1)
  const feels = feelsLike(tNow, st?.rh ?? c.relative_humidity_2m ?? null, c.wind_speed_10m).feels
  const next = wetNow ? 'Raining now' : firstRadar ? `Rain at ${clock(firstRadar.at)}` : wetHour ? `Rain at ${new Date(wetHour.at).getHours() % 12 || 12}` : null
  const rainInMin = !wetNow && firstRadar ? Math.max(0, Math.round((firstRadar.at - now) / 60000)) : null

  // When the rain comes, in one line.
  let rain = 'No rain today'
  let rainSky: Sky = 'cloud'
  const wet = (x: WxHour) => x.pop >= 50 || x.mm >= 0.5
  const startAt = wetNow ? now : firstRadar?.at ?? wetHour?.at ?? null
  if (startAt != null) {
    rainSky = 'rain'
    let end: WxHour | null = null
    let heavy: WxHour | null = null
    let seen = false
    for (const x of hours) {
      if (x.at + 3600000 <= startAt) continue
      if (wet(x)) { seen = true; end = x; if (!heavy || x.mm > heavy.mm) heavy = x } else if (seen) break
    }
    const from = wetNow ? null : firstRadar ? clock(firstRadar.at) : wetHour ? hourWord(wetHour.at) : null
    const until = end ? hourWord(end.at + 3600000) : null
    const heaviest = heavy && end && heavy.at !== end.at && heavy.mm >= 1 ? `, heaviest at ${new Date(heavy.at).getHours() % 12 || 12}` : ''
    if (wetNow) rain = until ? `Raining now, until about ${until}${heaviest}` : 'Raining now'
    else if (from && until) rain = `Rain ${from} to ${until}${heaviest}`
    else if (from) rain = `Rain from ${from}`
  }

  // High / low and the week: EC's city forecast, Open-Meteo's daily when EC is missing.
  const days = om.daily.time.map((t, i) => ({ at: omTime(`${t}T12:00`, off), hi: om.daily.temperature_2m_max[i], lo: om.daily.temperature_2m_min[i], sky: wmoSky(om.daily.weather_code[i], true) }))
  const city = input.city ?? null
  let hi: number | null = days[0]?.hi ?? null
  let lo: number | null = days[0]?.lo ?? null
  let week: WxDay[] = days.slice(0, 7).map(d => ({ at: d.at, sky: d.sky, hi: d.hi, lo: d.lo, words: SKY_WORDS[d.sky] }))
  if (city && city.periods.length > 0) {
    const ps = city.periods
    const night = (p: CityPeriod) => /night/i.test(p.name)
    const first = ps[0]
    if (!night(first) && first.high != null) hi = first.high
    const firstNight = ps.find(night)
    if (firstNight?.low != null) lo = firstNight.low
    const out: WxDay[] = []
    let i = 0
    if (night(first)) {
      // An afternoon or evening read starts with tonight: today's high from the model, tonight's sky and low.
      out.push({ at: days[0]?.at ?? now, sky: first.icon != null ? ecSky(first.icon) : days[0]?.sky ?? 'cloud', hi: days[0]?.hi ?? null, lo: first.low, words: first.words || SKY_WORDS[days[0]?.sky ?? 'cloud'] })
      i = 1
    }
    for (; i < ps.length && out.length < 7; i++) {
      const p = ps[i]
      if (night(p)) continue
      const n = ps[i + 1] && night(ps[i + 1]) ? ps[i + 1] : null
      out.push({ at: days[out.length]?.at ?? now + out.length * 86400000, sky: p.icon != null ? ecSky(p.icon) : 'cloud', hi: p.high, lo: n?.low ?? null, words: p.words })
    }
    if (out.length > 0) week = out
  }
  return {
    now: { t: tNow, feels, sky: skyNow, words: wetNow ? 'Raining' : SKY_WORDS[skyNow] },
    next, rainInMin, hours, hi, lo, rain, rainSky, week, warnings: city?.warnings ?? [], at: now,
  }
}

// ─── The coach line (page 72 §3): only when it matters ─────────

export interface PlannedOutdoor {
  /** "Run" */
  name: string
  /** Epoch ms of the planned hour. */
  at: number
  /** "Morning" / "Evening" when the hour is only a fallback (none learned yet): the line names that, not a clock hour. */
  when?: string | null
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * One line under the weather when the weather at a planned run's hour crosses
 * a line; null on a plain day. It names the session, the hour and the weather,
 * offers a way out, and never moves anything.
 */
export function coachLine(w: Weather, planned: ReadonlyArray<PlannedOutdoor>, now: number, unit: 'C' | 'F' = 'C'): { text: string; sky: Sky; kind: 'rain' | 'cold' | 'heat' | 'storm' } | null {
  for (const p of planned) {
    if (p.at + 3600000 < now) continue
    const hr = w.hours.find(x => p.at >= x.at && p.at < x.at + 3600000) ?? (p.at < (w.hours[0]?.at ?? 0) ? w.hours[0] : null)
    // Thunder, freezing rain, or an EC warning.
    if (w.warnings.length > 0) return { text: `${sentence(w.warnings[0])}.`, sky: 'storm', kind: 'storm' }
    const freezing = w.hours.find(x => x.at + 3600000 > now && x.at <= p.at + 3600000 && [56, 57, 66, 67].includes(x.code))
    if (freezing) return { text: `Freezing rain from ${hourWord(freezing.at)}.`, sky: 'rain', kind: 'storm' }
    const thunder = w.hours.find(x => x.at + 3600000 > now && x.at <= p.at + 3600000 && x.code >= 95)
    if (thunder) return { text: `Thunder from ${hourWord(thunder.at)}.`, sky: 'storm', kind: 'storm' }
    // Rain in about N min (radar), and he's about to start.
    if (w.rainInMin != null && p.at - now <= 60 * 60000) return { text: `Rain in about ${Math.max(5, Math.round(w.rainInMin / 5) * 5)} min.`, sky: 'rain', kind: 'rain' }
    if (!hr) continue
    const head = p.when ? `${p.name} this ${p.when.toLowerCase()}` : `${p.name} at ${hourWord(p.at)}`
    if (hr.pop >= 60 || hr.mm >= 1) return { text: `${head}: ${degText(hr.t, unit)}° and rain.`, sky: 'rain', kind: 'rain' }
    if (hr.feels <= -15) return { text: `${head}: feels ${degText(hr.feels, unit)}°. Cover your face.`, sky: hr.sky, kind: 'cold' }
    if (hr.humidex != null && hr.humidex >= 32) return { text: `${head}: humidex ${Math.round(hr.humidex)}. Go easy and take water.`, sky: 'sun', kind: 'heat' }
  }
  return null
}

// ─── Fetching (the phone, no keys) ─────────────────────────────

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json() as Promise<T>
}

const OGC = 'https://api.weather.gc.ca/collections'
const GEOMET = 'https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0'
const NOWCAST = 'Radar_1km_RainPrecipRate-Extrapolation'

/** The nearest EC station within 10 km, its latest reading. */
async function loadStation(lat: number, lon: number, signal?: AbortSignal): Promise<Station | null> {
  const st = await json<{ features: Array<{ properties: { msc_id: string }; geometry: { coordinates: number[] } }> }>(`${OGC}/swob-stations/items?f=json&limit=40&bbox=${(lon - 0.15).toFixed(2)},${(lat - 0.1).toFixed(2)},${(lon + 0.15).toFixed(2)},${(lat + 0.1).toFixed(2)}`, signal)
  const near = st.features.map(f => ({ id: f.properties.msc_id, km: dist(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) })).filter(s => s.km <= 10).sort((a, b) => a.km - b.km)
  for (const s of near.slice(0, 3)) {
    const r = await json<{ features: Array<{ properties: Record<string, unknown> }> }>(`${OGC}/swob-realtime/items?f=json&msc_id-value=${encodeURIComponent(s.id)}&sortby=-date_tm-value&limit=1`, signal).catch(() => null)
    const p = r?.features[0]?.properties
    const t = Number(p?.air_temp)
    if (p && p.air_temp != null && Number.isFinite(t)) return { t, rh: p.rel_hum != null && Number.isFinite(Number(p.rel_hum)) ? Number(p.rel_hum) : null, at: Date.parse(String(p['date_tm-value'])) }
  }
  return null
}

/** EC's radar nowcast at this point: the next hour in 6-minute steps, and the radar now. */
async function loadRadar(lat: number, lon: number, now: number, signal?: AbortSignal): Promise<{ steps: Array<{ at: number; mm: number }>; nowMm: number | null }> {
  const cap = await fetch(`${GEOMET}&request=GetCapabilities&layer=${NOWCAST}`, { signal }).then(r => r.text())
  const dim = cap.match(/<Dimension name="time"[^>]*>([^<]+)</)?.[1]?.split('/')
  const times: number[] = []
  if (dim && dim.length >= 2) {
    const t0 = Date.parse(dim[0]), t1 = Date.parse(dim[1])
    for (let t = t0; t <= t1 && times.length < 10; t += 360000) if (t > now - 180000) times.push(t)
  }
  const bbox = `${(lat - 0.01).toFixed(3)},${(lon - 0.01).toFixed(3)},${(lat + 0.01).toFixed(3)},${(lon + 0.01).toFixed(3)}`
  const at = (layer: string, t?: number) => json<{ features?: Array<{ properties?: { value?: unknown } }> }>(`${GEOMET}&request=GetFeatureInfo&layers=${layer}&query_layers=${layer}&crs=EPSG:4326&bbox=${bbox}&width=3&height=3&i=1&j=1&info_format=application/json${t ? `&time=${new Date(t).toISOString().slice(0, 19)}Z` : ''}`, signal)
    .then(r => Number(r.features?.[0]?.properties?.value) || 0)
  const steps = await Promise.all(times.map(t => at(NOWCAST, t).catch(() => 0).then(mm => ({ at: t, mm }))))
  const nowMm = await at('RADAR_1KM_RRAI').catch(() => null)
  return { steps, nowMm }
}

/** EC's city page nearest the point. */
async function loadCity(lat: number, lon: number, signal?: AbortSignal): Promise<City | null> {
  const list = await json<{ features: Array<{ id: string; geometry: { coordinates: number[] } }> }>(`${OGC}/citypageweather-realtime/items?f=json&limit=50&properties=identifier&bbox=${(lon - 0.6).toFixed(2)},${(lat - 0.4).toFixed(2)},${(lon + 0.6).toFixed(2)},${(lat + 0.4).toFixed(2)}`, signal)
  const near = list.features.map(f => ({ id: f.id, km: dist(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) })).sort((a, b) => a.km - b.km)[0]
  if (!near) return null
  const item = await json<{ properties: Record<string, unknown> }>(`${OGC}/citypageweather-realtime/items/${encodeURIComponent(near.id)}?f=json`, signal)
  return parseCity(item.properties)
}

/** Open-Meteo, the best model for the spot. */
function openMeteoUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}`
    + '&current=temperature_2m,weather_code,wind_speed_10m,is_day,relative_humidity_2m'
    + '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,is_day,relative_humidity_2m,wind_speed_10m'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
    + '&forecast_hours=12&forecast_days=7&timezone=auto'
}

/**
 * Read the weather for a point (already rounded to about 1 km). Null when the
 * hours can't be had (no signal): the strip hides. The other sources only
 * make it better.
 */
export async function loadWeather(lat: number, lon: number, signal?: AbortSignal): Promise<Weather | null> {
  const now = Date.now()
  const [om, station, radar, city] = await Promise.all([
    json<OpenMeteo>(openMeteoUrl(lat, lon), signal).catch(() => null),
    loadStation(lat, lon, signal).catch(() => null),
    loadRadar(lat, lon, now, signal).catch(() => null),
    loadCity(lat, lon, signal).catch(() => null),
  ])
  if (!om || !om.hourly?.time?.length) return null
  return buildWeather({ now, om, station, radar: radar?.steps ?? null, radarNow: radar?.nowMm ?? null, city })
}
