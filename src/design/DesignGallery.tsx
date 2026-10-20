import { useEffect, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { PageErrorScreen, SessionInterruptedScreen } from '@/components/ui/ErrorScreens'
import { CheckInDeck } from '@/features/blockZero/CheckInDeck'
import { MtClassLogCard } from '@/features/blockZero/ClassTypeCard'
import { EffortCard } from '@/features/blockZero/EffortCard'
import { EndGateView } from '@/features/blockZero/EndGate'
import { MorningReportRow } from '@/features/blockZero/TodayPieces'
import { BodyProfileBoard } from '@/features/settings/BodyProfileBoard'

import {
  AmPmFlap,
  AmPmHeader,
  Board,
  Crest,
  FlapButton,
  FlapChip,
  FlapDrum,
  FlapLabel,
  FlapSwitch,
  SessionIcon,
  TileChoice,
  showPop,
  type SessionIconKey,
} from './index'

// DEV ONLY (/design?screen=...): every new screen with sample data, so they
// can be screenshotted at iPhone size and compared with the mockups. The
// route exists only in `vite` dev; a build never includes this file.

const noop = () => {}
const ICONS: SessionIconKey[] = ['strength', 'bag', 'mt', 'zone2', 'run', 'rope', 'foundation', 'reset', 'core', 'mobility', 'waybook']

const TEST_ROWS = [
  { week: 1, testKey: 'talk_test_hr', value: 142, unit: 'bpm' },
  { week: 1, testKey: 'e1rm:ex-front-squat', value: 77, unit: 'kg' },
  { week: 6, testKey: 'talk_test_hr', value: 146, unit: 'bpm' },
  { week: 6, testKey: 'e1rm:ex-front-squat', value: 88.5, unit: 'kg' },
]

const READY_EASE = { checkedIn: true, ease: true, worseItems: ['sleepHours', 'backToday'], reason: 'Sleep and your back are off your 7-day trend for 2 days.', items: [] }

function Phone({ children, world = true }: { children: ReactNode; world?: boolean }) {
  return (
    <div
      style={{
        width: 390,
        minHeight: 844,
        margin: '0 auto',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '54px 12px 24px',
        background: world
          ? 'radial-gradient(ellipse 120% 40% at 50% -10%, rgba(232,200,96,.06), transparent 60%), linear-gradient(175deg, #0a1a14, #050c09)'
          : '#050907',
      }}
    >
      {children}
    </div>
  )
}

function Foundation() {
  useEffect(() => {
    showPop('Logged.', 'good', { durationMs: 600000 })
    showPop("Couldn't save. Check your connection.", 'bad', { durationMs: 600000 })
  }, [])
  return (
    <Phone>
      <div style={{ height: 120 }} />
      <Board head="Flap labels" headRight={<FlapLabel text="SAT 18 OCT" size="xs" />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <FlapLabel text="STRENGTH C" size="md" len={12} />
          <FlapLabel text="NEXT ROUND" size="sm" tone="teal" />
          <FlapLabel text="LAST 10" size="sm" tone="clay" />
          <FlapLabel text="WAYMARK" size="lg" tone="gold" />
          <FlapLabel text="0:45" size="lg" />
        </div>
      </Board>
      <Board head="AM / PM · switches">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <AmPmFlap slot="am" onChange={noop} />
          <AmPmFlap slot="pm" onChange={noop} />
          <AmPmHeader slot="am" />
          <FlapSwitch on onChange={noop} label="Haptics" />
          <FlapSwitch on={false} onChange={noop} label="Face ID" />
        </div>
      </Board>
      <Board head="Session icons">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {ICONS.map(k => <SessionIcon key={k} kind={k} size={40} />)}
          <Crest width={40} />
        </div>
      </Board>
      <Board edge="good" head="Tiles · drum">
        <TileChoice label="demo" columns={4} options={[{ value: 3, label: '3+', sub: 'easy' }, { value: 2, label: '2', sub: 'solid' }, { value: 1, label: '1', sub: 'hard' }, { value: 0, label: '0', sub: 'nothing' }]} selected={2} refused={0} onPick={noop} />
        <div style={{ height: 10 }} />
        <FlapDrum label="Push-ups" value={18} onChange={noop} unit="reps" />
      </Board>
      <div className="wm-btns">
        <FlapButton label="CANCEL" />
        <FlapButton label="SAVE" primary />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <FlapChip label="+ CLASS TONIGHT" />
        <FlapChip label="EDIT" />
      </div>
    </Phone>
  )
}

function Gallery({ screen }: { screen: string }) {
  switch (screen) {
    case 'foundation':
      return <Foundation />
    case 'checkin':
      return <Phone><CheckInDeck date="2026-10-18" onSubmit={async () => null} onClose={noop} /></Phone>
    case 'checkin-back':
      return <Phone><CheckInDeck date="2026-10-18" startAt={6} existing={{ sleepHours: 7, sleepQuality: 4, energy: 3, soreness: 3, stress: 2, mood: 4 }} onSubmit={async () => null} onClose={noop} /></Phone>
    case 'checkin-done':
      return <Phone><CheckInDeck date="2026-10-18" onSubmit={async () => null} onClose={noop} previewSettled={READY_EASE} /></Phone>
    case 'today':
      return (
        <Phone>
          <MorningReportRow logged readiness={{ tone: 'good', text: 'Good to go.', lead: 'Good to go.', rest: '', why: 'Everything is near your 7-day average.' }} onOpen={noop} />
          <MorningReportRow logged={false} readiness={null} onOpen={noop} />
        </Phone>
      )
    case 'effort':
      return <Phone><EffortCard setLabel="Set 2 of 3" onPick={noop} onSkip={noop} /></Phone>
    case 'class':
      return <Phone><MtClassLogCard classType="general" minutes={60} note="" error={null} saving={false} onType={noop} onMinutes={noop} onNote={noop} onSave={noop} /></Phone>
    case 'gate':
      return (
        <EndGateView
          rows={TEST_ROWS}
          result={{ decision: 'proceed', rationale: 'Consistency held, the back is steadier, the numbers are in. Fighter Block 1 starts from the new maxes.', rules: { decision: 'proceed', reasons: ['Key sessions done: 84%.', 'Back: steadier than week 1.'], extendWeeks: 0, totalWeeks: 6 }, nextBlockId: 'b2' }}
          checking={false}
          onCheck={noop}
          onPrimary={noop}
          onBack={noop}
        />
      )
    case 'gate-extend':
      return (
        <EndGateView
          rows={TEST_ROWS}
          result={{ decision: 'hold', rationale: 'Extend one week. Two gaps in weeks 4–5 and the back dipped last week. Training stays at week-5 levels.', rules: { decision: 'extend', reasons: ['A 9-day gap in the last 3 weeks.'], extendWeeks: 1, totalWeeks: 7 }, nextBlockId: null }}
          checking={false}
          onCheck={noop}
          onPrimary={noop}
          onBack={noop}
        />
      )
    case 'gate-check':
      return <EndGateView rows={TEST_ROWS} result={null} checking={false} onCheck={noop} onPrimary={noop} onBack={noop} />
    case 'error-session':
      return <SessionInterruptedScreen sessionId="demo" onResume={noop} onBack={noop} preview={[{ name: 'Front Squat', detail: '2×8 · 140' }, { name: 'RDL', detail: '2×7 · 115' }, { name: 'Split Squat', detail: '1 of 2 sets' }]} />
    case 'error-page':
      return <PageErrorScreen pathname="/history" onReload={noop} onBack={noop} />
    case 'settings':
      return <Phone world={false}><BodyProfileBoard /></Phone>
    default:
      return (
        <Phone>
          <Board head="Design gallery">
            <p className="wm-prose">?screen= foundation, checkin, checkin-back, checkin-done, today, effort, class, gate, gate-extend, gate-check, error-session, error-page, settings</p>
          </Board>
        </Phone>
      )
  }
}

export default function DesignGallery() {
  const [params] = useSearchParams()
  return <Gallery screen={params.get('screen') ?? ''} />
}
