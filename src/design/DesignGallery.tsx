import { useEffect, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { PageErrorScreen, SessionInterruptedScreen } from '@/components/ui/ErrorScreens'
import { CheckInDeck } from '@/features/blockZero/CheckInDeck'
import { ClassTypeCard } from '@/features/blockZero/ClassTypeCard'
import { EffortCard } from '@/features/blockZero/EffortCard'
import { EndGateView } from '@/features/blockZero/EndGate'
import { BlockZeroProgramBoards } from '@/features/blockZero/ProgramBoards'
import { GuidedTestView, ResultsSheetCard, TestEntryCard } from '@/features/blockZero/TestWeekPage'
import { MorningReportCard, TodayHeroCard } from '@/features/blockZero/TodayPieces'
import { readinessLine } from '@/features/blockZero/readinessLine'
import { GUIDED_TESTS, initialGuided } from '@/features/blockZero/testWeek'
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
  { week: 1, testKey: 'pushups_max', value: 18, unit: 'reps' },
  { week: 1, testKey: 'side_plank_sec_l', value: 45, unit: 's' },
  { week: 1, testKey: 'side_plank_sec_r', value: 40, unit: 's' },
  { week: 1, testKey: 'fixed_effort_hr', value: 151, unit: 'bpm' },
  { week: 1, testKey: 'e1rm:ex-back-squat', value: 77, unit: 'kg' },
  { week: 6, testKey: 'talk_test_hr', value: 146, unit: 'bpm' },
  { week: 6, testKey: 'pushups_max', value: 27, unit: 'reps' },
  { week: 6, testKey: 'fixed_effort_hr', value: 139, unit: 'bpm' },
  { week: 6, testKey: 'side_plank_sec_l', value: 40, unit: 's' },
  { week: 6, testKey: 'e1rm:ex-back-squat', value: 88.5, unit: 'kg' },
]

const READY_EASE = { checkedIn: true, ease: true, worseItems: ['sleepHours', 'backToday'], reason: 'Sleep and your back are off your 7-day trend for 2 days.', items: [] }
const READY_GOOD = { checkedIn: true, ease: false, worseItems: [], reason: null, items: [{ item: 'sleepHours', today: 7, mean7: 7.2, worse: false }] }

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
      return <Phone><CheckInDeck date="2026-10-18" onSubmit={async () => null} onClose={noop} onSkipToday={noop} /></Phone>
    case 'checkin-back':
      return <Phone><CheckInDeck date="2026-10-18" startAt={6} existing={{ sleepHours: 7, sleepQuality: 4, energy: 3, soreness: 3, stress: 2, mood: 4 }} onSubmit={async () => null} onClose={noop} /></Phone>
    case 'checkin-done':
      return <Phone><CheckInDeck date="2026-10-18" onSubmit={async () => null} onClose={noop} previewSettled={READY_EASE} /></Phone>
    case 'today':
      return (
        <Phone>
          <div style={{ flex: 1 }} />
          <TodayHeroCard line={readinessLine(READY_EASE)} showClassChip classAdded={false} onAddClass={async () => null} />
          <MorningReportCard answers={{ sleepHours: 6, energy: 2, soreness: 4, backToday: 2 }} onCheckIn={noop} onEdit={noop} onAddNote={noop} />
          <MorningReportCard answers={null} onCheckIn={noop} onEdit={noop} onAddNote={noop} />
          <TodayHeroCard line={readinessLine(READY_GOOD)} showClassChip classAdded onAddClass={async () => null} />
        </Phone>
      )
    case 'effort':
      return <Phone><EffortCard setLabel="Set 2 of 3" onPick={noop} onSkip={noop} /></Phone>
    case 'class':
      return <Phone><ClassTypeCard blockZero onSave={async () => null} onDone={noop} onClose={noop} initialRefused={{ type: 'sparring', reason: 'No hard sparring in Block Zero. Take the technique class or work pads.' }} /></Phone>
    case 'tests':
      return <GuidedTestView week={1} tests={GUIDED_TESTS} state={{ ...initialGuided(GUIDED_TESTS), index: 2, saved: { talk_test_hr: 142, fixed_effort_hr: 151 } }} saving={false} onDial={noop} onNext={noop} onSkip={noop} onBack={noop} onExit={noop} onOpenSheet={noop} />
    case 'tests-score':
      return <GuidedTestView week={1} tests={GUIDED_TESTS} state={{ ...initialGuided(GUIDED_TESTS), index: 7 }} saving={false} onDial={noop} onNext={noop} onSkip={noop} onBack={noop} onExit={noop} onOpenSheet={noop} />
    case 'tests-done':
      return <GuidedTestView week={1} tests={GUIDED_TESTS} state={{ ...initialGuided(GUIDED_TESTS), index: GUIDED_TESTS.length, done: true, saved: { talk_test_hr: 142, fixed_effort_hr: 151, pushups_max: 18, side_plank_sec_l: 45, side_plank_sec_r: 40, calf_raise_reps_l: 16, calf_raise_reps_r: 14 } }} saving={false} onDial={noop} onNext={noop} onSkip={noop} onBack={noop} onExit={noop} onOpenSheet={noop} />
    case 'sheet':
      return <Phone><ResultsSheetCard week={1} totalWeeks={6} rows={TEST_ROWS} onEnter={noop} onClose={noop} /></Phone>
    case 'entry':
      return <Phone><TestEntryCard spec={GUIDED_TESTS[3]} start={45} saving={false} onSave={noop} onClose={noop} /></Phone>
    case 'program':
      return (
        <Phone>
          <BlockZeroProgramBoards currentWeek={2} viewWeek={2} totalWeeks={6} onPickWeek={noop} onOpenTests={noop} onOpenGate={noop} />
          <BlockZeroProgramBoards currentWeek={1} viewWeek={1} totalWeeks={6} onPickWeek={noop} onOpenTests={noop} onOpenGate={noop} />
        </Phone>
      )
    case 'program-6':
      return <Phone><BlockZeroProgramBoards currentWeek={6} viewWeek={6} totalWeeks={6} onPickWeek={noop} onOpenTests={noop} onOpenGate={noop} /></Phone>
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
      return <SessionInterruptedScreen sessionId="demo" onResume={noop} onBack={noop} preview={[{ name: 'Back Squat', detail: '2×8 · 140' }, { name: 'RDL', detail: '2×7 · 115' }, { name: 'Split Squat', detail: '1 of 2 sets' }]} />
    case 'error-page':
      return <PageErrorScreen pathname="/history" onReload={noop} onBack={noop} />
    case 'settings':
      return <Phone world={false}><BodyProfileBoard /></Phone>
    default:
      return (
        <Phone>
          <Board head="Design gallery">
            <p className="wm-prose">?screen= foundation, checkin, checkin-back, checkin-done, today, effort, class, tests, tests-score, tests-done, sheet, entry, program, program-6, gate, gate-extend, gate-check, error-session, error-page, settings</p>
          </Board>
        </Phone>
      )
  }
}

export default function DesignGallery() {
  const [params] = useSearchParams()
  return <Gallery screen={params.get('screen') ?? ''} />
}
