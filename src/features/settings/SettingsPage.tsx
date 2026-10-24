import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Board, FlapLabel, FlapSwitch } from '@/design'
import { apiFetch } from '@/lib/api'
import { scheduleAlarms } from '@/lib/notifications'
import { coachLine, nextAlarmDay } from '@/lib/coachLine'
import { getTodayISO } from '@/lib/dates'
import { ONE_PACE_ARCS } from '@/lib/onePace'
import { TreadmillUnitRow } from './TreadmillUnitRow'
import { NARUTO_ARC_NAMES, NARUTO_EPISODES, narutoArcForEp, narutoEpDrumStart } from '@/lib/naruto'
import { isHapticsEnabled, setHapticsEnabled, tapHaptic } from '@/lib/haptics'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { useToast } from '@/components/ui/Toast'
import { isGateEnabled, setGateEnabled } from '@/lib/waybookGate'
import { WorldTimeBoard } from './WorldTimeBoard'
import { BodyProfileBoard } from './BodyProfileBoard'
import { StrapBoard } from './StrapBoard'
import { ArcCard, NumberCard, TimeCard } from './SettingsCards'
import { ChevValue, MOON_MARK, SBlock, SRow, SettingsScreen, SUN_MARK, TimeValue } from './settingsParts'
import { classDayState, classDayWord, cycleClassDay, formatClassSlots, parseClassSlots, type ClassDaySlot } from '@/lib/classSlots'
import { goBack } from '@/lib/goBack'
import { getItem as storageGet, setItem as storageSet } from '@/lib/safeStorage'
import { loadLast, saveLast, type IntervalSetup } from '@/lib/timers/intervalTimer'
import { IntervalTimerWindow } from '@/features/timer/IntervalTimerWindow'
import { IntervalTimerScreen } from '@/features/timer/IntervalTimerScreen'
import { daysUntilRedeploy, leadFlap, splitTime, timeFlap } from './settingsModel'

interface Settings {
  mtClassDays: string | null
  /** Page 70: "mon:pm,sat:any". */
  mtClassSlots?: string | null
  amReminder: string | null
  pmLeadMin: number | null
  pmSessionTime: string | null
  onePaceArc: string | null
  onePaceEp: string | null
  narutoArc: string | null
  narutoEp: number | null
  lastDeploy: number | null
  enabledTechniques: string | null
  amEnabled: number | null
  pmEnabled: number | null
  cascade?: { removed: number; freedDays?: string[]; freed?: Array<{ day: string; slot: 'AM' | 'PM' }> } | null
}

const TECHNIQUES = [
  { key: 'boxing', label: 'BOXING' },
  { key: 'kicks', label: 'KICKS' },
  { key: 'defensive', label: 'DEFENSIVE' },
  { key: 'knees', label: 'KNEES' },
  { key: 'elbows', label: 'ELBOWS' },
]

// The stored day keys (0 = Sunday), Monday first as page 37 draws them.
const DAYS = [
  { key: '1', label: 'MO' }, { key: '2', label: 'TU' }, { key: '3', label: 'WE' }, { key: '4', label: 'TH' },
  { key: '5', label: 'FR' }, { key: '6', label: 'SA' }, { key: '0', label: 'SU' },
]
const DAY_NAMES: Record<string, string> = { '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday' }

type Card = 'am' | 'pm' | 'lead' | 'opArc' | 'opEp' | 'nArc' | 'nEp' | null

/**
 * Settings, page 37 A (approved): five grouped boards on the solid dark, no
 * world behind them: Training, Alarms, Body, World, Connections, with the
 * "5D until redeploy" badge on top. Every switch is an ON / OFF flap; times
 * open the centred time card.
 */
export function SettingsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const { show: showToast } = useToast()
  const [showReplacementPicker, setShowReplacementPicker] = useState(false)
  const hydratedRef = useRef(false)
  const [card, setCard] = useState<Card>(null)
  /** Page 81: the hidden interval timer, its window or running. */
  const [timer, setTimer] = useState<{ setup: IntervalSetup; running?: boolean } | null>(null)

  const [mtDays, setMtDays] = useState<Set<string>>(new Set())
  const [mtSlots, setMtSlots] = useState<Partial<Record<number, ClassDaySlot>>>({})
  /** The day tapped last: only its mark fades in (page 59: one step, no load-in on open). */
  const [tappedDay, setTappedDay] = useState<string | null>(null)
  const [amReminder, setAmReminder] = useState('06:30')
  const [amEnabled, setAmEnabled] = useState(true)
  const [pmLeadMin, setPmLeadMin] = useState(60)
  const [pmSessionTime, setPmSessionTime] = useState('18:00')
  const [pmEnabled, setPmEnabled] = useState(true)
  const [onePaceArc, setOnePaceArc] = useState('')
  const [onePaceEp, setOnePaceEp] = useState('')
  const [narutoArc, setNarutoArc] = useState('')
  const [narutoEp, setNarutoEp] = useState('')
  const [enabledTechniques, setEnabledTechniques] = useState<Set<string>>(new Set(['boxing', 'kicks', 'defensive']))

  const [waybookAuth, setWaybookAuth] = useState<boolean>(() => isGateEnabled())
  const [hapticsOn, setHapticsOn] = useState<boolean>(() => isHapticsEnabled())

  function handleHaptics(next: boolean) {
    setHapticsEnabled(next)
    setHapticsOn(next)
    if (next) void tapHaptic()
  }

  // On by default; turning it off asks for Face ID first (page 61 part 1).
  async function handleWaybookAuth(next: boolean) {
    if (await setGateEnabled(next)) setWaybookAuth(next)
  }

  useEffect(() => {
    async function load() {
      try {
        const s = await apiFetch<Settings | null>('/api/settings')
        if (s) {
          setMtDays(new Set((s.mtClassDays ?? '').split(',').filter(Boolean)))
          setMtSlots(parseClassSlots(s.mtClassSlots))
          setAmReminder(s.amReminder ?? '06:30')
          setAmEnabled(s.amEnabled !== 0)
          setPmLeadMin(s.pmLeadMin ?? 60)
          setPmSessionTime(s.pmSessionTime ?? '18:00')
          setPmEnabled(s.pmEnabled !== 0)
          setOnePaceArc(s.onePaceArc ?? '')
          setOnePaceEp(s.onePaceEp ?? '')
          setNarutoArc(s.narutoArc ?? '')
          setNarutoEp(s.narutoEp != null ? String(s.narutoEp) : '')
          setEnabledTechniques(new Set((s.enabledTechniques ?? 'boxing,kicks,defensive').split(',').filter(Boolean)))
        }
      } catch (e) {
        console.error('Failed to load settings:', e)
      } finally {
        setLoading(false)
        // Defer hydration so the save effect's first run (post-load) is skipped
        requestAnimationFrame(() => { hydratedRef.current = true })
      }
    }
    load()
  }, [])

  // Saved 0.8 s after the last change, and on leave (page 61: ‹ TODAY right after DONE keeps it).
  const flushSettings = useRef<(() => void) | null>(null)
  const lastSave = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!hydratedRef.current) return
    const run = async () => {
      flushSettings.current = null
      lastSave.current?.abort()
      const controller = new AbortController()
      lastSave.current = controller
      try {
        const updated = await apiFetch<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            mtClassDays: Array.from(mtDays).join(','),
            mtClassSlots: formatClassSlots(Array.from(mtDays).map(Number), mtSlots),
            amReminder,
            pmLeadMin,
            pmSessionTime,
            onePaceArc: onePaceArc || null,
            onePaceEp: onePaceEp || null,
            narutoArc: narutoArc || null,
            narutoEp: narutoEp === '' ? null : Number(narutoEp),
            enabledTechniques: Array.from(enabledTechniques).join(','),
            amEnabled,
            pmEnabled,
          }),
          signal: controller.signal,
        })
        if (controller.signal.aborted) return

        // The alarm keeps its one quiet line (page 56 item 12).
        coachLine('morning', nextAlarmDay(getTodayISO(), amReminder))
          .then(line => scheduleAlarms(amReminder, pmSessionTime, pmLeadMin, { amEnabled, pmEnabled, coachLine: line }))
          .catch(() => {})

        // The slot each day freed (page 70): AM or PM as he chose it; ANY frees nothing until a placed class goes.
        const freed = updated.cascade?.freed ?? (updated.cascade?.freedDays ?? []).map(day => ({ day, slot: 'PM' as const }))
        if (updated.cascade && updated.cascade.removed > 0 && freed.length > 0) {
          const bySlot = (['AM', 'PM'] as const).map(slot => ({ slot, days: freed.filter(f => f.slot === slot).map(f => f.day) })).filter(g => g.days.length > 0)
          showToast(bySlot.map(g => `${g.days.join(', ')} ${g.slot} slot${g.days.length > 1 ? 's' : ''}`).join(', ') + ' freed up', 'info')
          setShowReplacementPicker(true)
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        console.error('Failed to save settings:', e)
        showToast('Save didn\'t land. Try again.', 'warning')
      }
    }
    flushSettings.current = () => { void run() }
    const t = setTimeout(() => { void run() }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mtDays, mtSlots, amReminder, amEnabled, pmLeadMin, pmSessionTime, pmEnabled, onePaceArc, onePaceEp, narutoArc, narutoEp, enabledTechniques])
  // Leaving with a change still waiting: send it now.
  useEffect(() => () => { flushSettings.current?.() }, [])

  /** Page 76: one flap per day; a tap goes OFF → AM → PM → ANY → OFF. */
  function cycleDay(day: string) {
    const next = cycleClassDay(new Set(Array.from(mtDays, Number)), mtSlots, Number(day))
    setMtDays(new Set(Array.from(next.days, String)))
    setMtSlots(next.slots)
    setTappedDay(day)
  }

  function setTechnique(tech: string, on: boolean) {
    const next = new Set(enabledTechniques)
    if (on) next.add(tech)
    else next.delete(tech)
    setEnabledTechniques(next)
  }

  const back = () => goBack(navigate, '/today')
  // Page 81: the crest held about 1 s opens the hidden interval timer (Logs stays on Today's crest).
  const openTimer = () => setTimer({ setup: loadLast(storageGet) })

  if (loading) {
    return <SettingsScreen title="SETTINGS" backLabel="TODAY" onBack={back} onSecretHold={openTimer}><div aria-busy="true" aria-label="Loading settings" /></SettingsScreen>
  }

  const daysLeft = daysUntilRedeploy(Number(import.meta.env.VITE_BUILD_TIME), Date.now())
  const am = splitTime(amReminder)
  const pm = splitTime(pmSessionTime)
  return (
    <>
    <SettingsScreen title="SETTINGS" backLabel="TODAY" onBack={back} onSecretHold={openTimer}>
      {daysLeft !== null && (
        <div className="st-badge" aria-label={`${daysLeft} days until redeploy`}>
          <FlapLabel text={`${daysLeft}D`} size="sm" tone="gold" animate={false} />
          until redeploy
        </div>
      )}

      <Board head="Training" solid className="st-board">
        <SBlock label="MT class days" sub="Classes are booked outside the app. Pick the days, and morning, evening or either.">
          {/* page 76: one flap per day, OFF → AM → PM → ANY; the lit tile carries its sun, moon or both. */}
          <div className="st-days" role="group" aria-label="MT class days">
            {DAYS.map(({ key, label }) => {
              const state = classDayState(new Set(Array.from(mtDays, Number)), mtSlots, Number(key))
              const tone = state === 'am' ? 'teal' : state === 'pm' ? 'clay' : state === 'any' ? 'gold' : 'ink'
              return (
                <button key={key} type="button" aria-label={`${DAY_NAMES[key]} class: ${classDayWord(state)}. Change`} data-slot={state} className={`st-day${state === 'off' ? '' : ' is-on'}`} onClick={() => cycleDay(key)}>
                  <FlapLabel text={label} size="xs" tone={tone} />
                  <span key={state} className={`st-mks${tappedDay === key ? ' is-new' : ''}`} aria-hidden>
                    {state === 'am' ? SUN_MARK : state === 'pm' ? MOON_MARK : state === 'any' ? <>{SUN_MARK}{MOON_MARK}</> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </SBlock>
        <TreadmillUnitRow />
        <SBlock label="Bag work techniques" sub="Combos using a technique that's off won't appear in sessions.">
          <div className="st-techs">
            {TECHNIQUES.map(({ key, label }) => {
              const on = enabledTechniques.has(key)
              return (
                <div key={key} className="st-tech" onClick={() => setTechnique(key, !on)}>
                  <FlapLabel text={label} size="xs" />
                  <FlapSwitch on={on} onChange={v => setTechnique(key, v)} label={label.toLowerCase()} />
                </div>
              )
            })}
          </div>
        </SBlock>
        <SRow label="One Pace arc" sub="Indoor runs." onClick={() => setCard('opArc')} ariaLabel={`One Pace arc, ${onePaceArc || 'not set'}. Change`}>
          <ChevValue text={onePaceArc.toUpperCase()} emptyCells={4} />
        </SRow>
        <SRow label="Episode" onClick={() => setCard('opEp')} ariaLabel={`One Pace episode, ${onePaceEp || 'not set'}. Change`}>
          <ChevValue text={onePaceEp} />
        </SRow>
        <SRow label="Naruto arc" sub="Indoor runs. Opens Netflix on this episode." onClick={() => setCard('nArc')} ariaLabel={`Naruto arc, ${narutoArc || 'not set'}. Change`}>
          <ChevValue text={narutoArc.toUpperCase()} emptyCells={4} />
        </SRow>
        <SRow label="Episode" onClick={() => setCard('nEp')} ariaLabel={`Naruto episode, ${narutoEp || 'not set'}. Change`}>
          <ChevValue text={narutoEp} />
        </SRow>
      </Board>

      <Board head="Alarms" solid className="st-board">
        <SRow label="Morning alarm" sub="The morning report. I'M UP opens Today.">
          <FlapSwitch on={amEnabled} onChange={setAmEnabled} label="Morning alarm" />
        </SRow>
        <SRow label="Time" onClick={() => setCard('am')} ariaLabel={`Morning alarm time, ${timeFlap(amReminder)} ${am.slot.toUpperCase()}. Change`}>
          <TimeValue text={timeFlap(amReminder)} slot={am.slot} />
        </SRow>
        <SRow label="Evening session" sub="A reminder before your PM session.">
          <FlapSwitch on={pmEnabled} onChange={setPmEnabled} label="Evening session" />
        </SRow>
        <SRow label="Session time" onClick={() => setCard('pm')} ariaLabel={`Session time, ${timeFlap(pmSessionTime)} ${pm.slot.toUpperCase()}. Change`}>
          <TimeValue text={timeFlap(pmSessionTime)} slot={pm.slot} />
        </SRow>
        <SRow label="Remind me" onClick={() => setCard('lead')} ariaLabel={`Remind me ${pmLeadMin} minutes before. Change`}>
          <span className="st-val"><FlapLabel text={leadFlap(pmLeadMin)} size="sm" /></span>
        </SRow>
        <p className="st-note">Silent switch on? Alarms go silent. Flip it to ring on training mornings, or turn on Vibrate on Silent in iOS Sounds &amp; Haptics.</p>
      </Board>

      <BodyProfileBoard />

      <WorldTimeBoard>
        <SRow label="Haptics" sub="Taps, timer ends and cues. Off keeps the phone still.">
          <FlapSwitch on={hapticsOn} onChange={handleHaptics} label="Haptics" />
        </SRow>
        <SRow label="Face ID for the Waybook" sub="Asks for Face ID before the Waybook opens.">
          <FlapSwitch on={waybookAuth} onChange={v => { void handleWaybookAuth(v) }} label="Face ID for the Waybook" />
        </SRow>
      </WorldTimeBoard>

      <StrapBoard />

      {card === 'am' && <TimeCard title="Morning alarm" value={amReminder} onCancel={() => setCard(null)} onDone={v => { setAmReminder(v); setCard(null) }} />}
      {card === 'pm' && <TimeCard title="Evening session" value={pmSessionTime} onCancel={() => setCard(null)} onDone={v => { setPmSessionTime(v); setCard(null) }} />}
      {card === 'lead' && (
        <NumberCard title="Remind me" sub="Minutes before your PM session." value={pmLeadMin} min={15} max={120} step={15} unit="MIN BEFORE" onCancel={() => setCard(null)} onDone={v => { setPmLeadMin(v); setCard(null) }} />
      )}
      {card === 'opArc' && (
        <ArcCard title="One Pace arc" arcs={ONE_PACE_ARCS} value={(ONE_PACE_ARCS as readonly string[]).includes(onePaceArc) ? onePaceArc : ONE_PACE_ARCS[0]} onCancel={() => setCard(null)} onDone={a => { setOnePaceArc(a); setCard(null) }} />
      )}
      {card === 'opEp' && (
        <NumberCard title="One Pace episode" value={Number(onePaceEp) || 1} min={1} max={999} onCancel={() => setCard(null)} onDone={v => { setOnePaceEp(String(v)); setCard(null) }} />
      )}
      {card === 'nArc' && (
        <ArcCard title="Naruto arc" arcs={NARUTO_ARC_NAMES} value={NARUTO_ARC_NAMES.includes(narutoArc) ? narutoArc : (narutoArcForEp(Number(narutoEp)) ?? NARUTO_ARC_NAMES[0])} onCancel={() => setCard(null)} onDone={a => { setNarutoArc(a); setCard(null) }} />
      )}
      {card === 'nEp' && (
        <NumberCard
          title="Naruto episode"
          sub="The arc follows the episode (approximate). Netflix resumes the episode itself."
          value={narutoEpDrumStart(narutoArc, narutoEp === '' ? null : Number(narutoEp))}
          min={1}
          max={NARUTO_EPISODES}
          onCancel={() => setCard(null)}
          onDone={v => { setNarutoEp(String(v)); setNarutoArc(narutoArcForEp(v) ?? ''); setCard(null) }}
        />
      )}

      {showReplacementPicker && (
        <SessionPicker
          onSelect={(option: SessionOption) => {
            setShowReplacementPicker(false)
            showToast(`${option.label} added as replacement`, 'success')
          }}
          onClose={() => setShowReplacementPicker(false)}
          filter={(opt: SessionOption) => opt.timeSlot === 'pm'}
        />
      )}
    </SettingsScreen>
    {timer && !timer.running && (
      <IntervalTimerWindow
        initial={timer.setup}
        onStart={setup => { saveLast(storageSet, setup); setTimer({ setup, running: true }) }}
        onClose={() => setTimer(t => (t?.running ? t : null))}
      />
    )}
    {timer?.running && <IntervalTimerScreen setup={timer.setup} onClose={() => setTimer(null)} />}
    </>
  )
}
