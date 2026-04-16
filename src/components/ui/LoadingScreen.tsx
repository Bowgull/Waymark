import { useEffect, useState } from 'react'

interface LoadingScreenProps {
  onReady?: () => void
  minDisplayMs?: number
}

// Rim path split at left (70,252) and right (430,252) midpoints into 4 arcs.
// Each arc originates FROM the midpoint, tracing toward crown or tip.
const ARC_UPPER_RIGHT = 'M430,252 C434,206 424,155 390,115 C356,75 304,56 250,56'
const ARC_LOWER_RIGHT = 'M430,252 C426,298 412,338 392,368 C372,398 348,420 322,442 C304,456 278,468 262,478 C256,481 252,483 250,485'
const ARC_UPPER_LEFT  = 'M70,252 C66,206 76,155 110,115 C144,75 196,56 250,56'
const ARC_LOWER_LEFT  = 'M70,252 C74,298 88,338 108,368 C128,398 152,420 178,442 C196,456 222,468 238,478 C244,481 248,483 250,485'

const EYE_OUTLINE = 'M250,192 C262,192 276,204 284,222 C292,240 294,260 290,278 C286,296 276,312 264,320 C258,324 254,326 250,326 C246,326 242,324 236,320 C224,312 214,296 210,278 C206,260 208,240 216,222 C224,204 238,192 250,192 Z'

// Shared stroke-dasharray value matching pathLength="1000" on each traced element
const DASH = '1000'

// Traced path helper — hidden until animation fires
function Arc({ d, stroke, strokeWidth, delay, duration = '1.1s', ease = 'cubic-bezier(0.4,0,0.2,1)' }: {
  d: string; stroke: string; strokeWidth: number
  delay: string; duration?: string; ease?: string
}) {
  return (
    <path
      pathLength={1000}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      d={d}
      style={{
        strokeDasharray: DASH,
        strokeDashoffset: DASH,
        animation: `trace-draw ${duration} ${ease} ${delay} both`,
      }}
    />
  )
}

function TracedCircle({ cx, cy, r, stroke, strokeWidth, delay, duration = '0.65s' }: {
  cx: number; cy: number; r: number; stroke: string; strokeWidth: number
  delay: string; duration?: string
}) {
  return (
    <circle
      pathLength={1000}
      cx={cx} cy={cy} r={r}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      style={{
        strokeDasharray: DASH,
        strokeDashoffset: DASH,
        animation: `trace-draw ${duration} cubic-bezier(0.4,0,0.2,1) ${delay} both`,
      }}
    />
  )
}

function Emerge({ delay, duration = '0.3s', children }: {
  delay: string; duration?: string; children: React.ReactNode
}) {
  return (
    <g style={{ animation: `loading-body-emerge ${duration} ease-out ${delay} both` }}>
      {children}
    </g>
  )
}

export function LoadingScreen({ onReady, minDisplayMs = 2000 }: LoadingScreenProps) {
  const [fading, setFading] = useState(false)
  const [breathe, setBreathe] = useState(false)

  useEffect(() => {
    const breatheTimer = setTimeout(() => setBreathe(true), 2900)
    const dismissTimer = setTimeout(() => {
      setFading(true)
      setTimeout(() => onReady?.(), 500)
    }, Math.max(minDisplayMs, 3600))

    return () => {
      clearTimeout(breatheTimer)
      clearTimeout(dismissTimer)
    }
  }, [minDisplayMs, onReady])

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-[#0a0a0a] transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}
    >
      {/* Ambient glow */}
      <div
        className={`pointer-events-none absolute ${breathe ? 'animate-loading-glow-pulse' : ''}`}
        style={{
          background: 'radial-gradient(ellipse at center, rgba(232,200,96,0.09) 0%, transparent 70%)',
          width: '360px',
          height: '360px',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          opacity: breathe ? undefined : 0.25,
        }}
      />

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 500 560"
          width={220}
          height={220}
          className={breathe ? 'animate-loading-breathe' : ''}
          style={{ overflow: 'visible' }}
        >
          <defs>
            <radialGradient id="ls-sbody" cx="36%" cy="26%" r="76%">
              <stop offset="0%"   stopColor="#224A3C"/>
              <stop offset="35%"  stopColor="#122E26"/>
              <stop offset="70%"  stopColor="#081A14"/>
              <stop offset="100%" stopColor="#020A08"/>
            </radialGradient>
            <radialGradient id="ls-sgold" cx="30%" cy="22%" r="75%">
              <stop offset="0%"   stopColor="#EAC460"/>
              <stop offset="40%"  stopColor="#C8A038"/>
              <stop offset="78%"  stopColor="#7A5E18"/>
              <stop offset="100%" stopColor="#2E1E04"/>
            </radialGradient>
            <radialGradient id="ls-seye" cx="38%" cy="30%" r="65%">
              <stop offset="0%"   stopColor="#42D0AA"/>
              <stop offset="45%"  stopColor="#1E8060"/>
              <stop offset="88%"  stopColor="#082C20"/>
              <stop offset="100%" stopColor="#030E0A"/>
            </radialGradient>
            <radialGradient id="ls-sinner" cx="40%" cy="32%" r="70%">
              <stop offset="0%"   stopColor="#163830"/>
              <stop offset="55%"  stopColor="#0A2018"/>
              <stop offset="100%" stopColor="#030C08"/>
            </radialGradient>
            <filter id="ls-shdw" x="-15%" y="-12%" width="130%" height="130%">
              <feDropShadow dx="0" dy="10" stdDeviation="22" floodColor="#000" floodOpacity="0.92"/>
              <feDropShadow dx="0" dy="3"  stdDeviation="6"  floodColor="#000" floodOpacity="0.6"/>
            </filter>
          </defs>

          {/* ── SHIELD BODY — emerges at 0s as substrate ── */}
          <Emerge delay="0s" duration="0.4s">
            <path filter="url(#ls-shdw)" fill="#0A1410"
              d="M250,30 C310,30 368,52 404,96 C440,140 452,196 448,248 C444,300 428,344 406,376 C384,408 358,430 330,452 C310,466 282,478 262,490 C256,493 252,496 250,498 C248,496 244,493 238,490 C218,478 190,466 170,452 C142,430 116,408 94,376 C72,344 56,300 52,248 C48,196 60,140 96,96 C132,52 190,30 250,30 Z"/>
            <path fill="url(#ls-sbody)"
              d="M250,34 C308,34 364,55 400,98 C436,141 448,196 444,247 C440,298 424,342 402,374 C380,406 355,428 328,450 C308,464 280,477 262,488 C256,491 252,494 250,496 C248,494 244,491 238,488 C220,477 192,464 172,450 C145,428 120,406 98,374 C76,342 60,298 56,247 C52,196 64,141 100,98 C136,55 192,34 250,34 Z"/>
          </Emerge>

          {/* ── RIM DARK LAYER — 4 arcs from midpoints at 0s ── */}
          <Arc d={ARC_UPPER_RIGHT} stroke="#0A1410" strokeWidth={28} delay="0s" />
          <Arc d={ARC_LOWER_RIGHT} stroke="#0A1410" strokeWidth={28} delay="0s" />
          <Arc d={ARC_UPPER_LEFT}  stroke="#0A1410" strokeWidth={28} delay="0s" />
          <Arc d={ARC_LOWER_LEFT}  stroke="#0A1410" strokeWidth={28} delay="0s" />

          {/* ── RIM GOLD LAYER — 0.1s behind dark ── */}
          <Arc d={ARC_UPPER_RIGHT} stroke="url(#ls-sgold)" strokeWidth={14} delay="0.1s" />
          <Arc d={ARC_LOWER_RIGHT} stroke="url(#ls-sgold)" strokeWidth={14} delay="0.1s" />
          <Arc d={ARC_UPPER_LEFT}  stroke="url(#ls-sgold)" strokeWidth={14} delay="0.1s" />
          <Arc d={ARC_LOWER_LEFT}  stroke="url(#ls-sgold)" strokeWidth={14} delay="0.1s" />

          {/* Rim inner shadow + inner field — appear after traces land */}
          <Emerge delay="1.1s">
            <path fill="none" stroke="#020706" strokeWidth="6"
              d="M250,70 C300,70 348,87 380,124 C412,161 422,210 418,254 C414,298 401,336 382,364 C363,392 340,414 316,435 C298,449 274,461 260,470 C255,473 252,475 250,476 C248,475 245,473 240,470 C226,461 202,449 184,435 C160,414 137,392 118,364 C99,336 86,298 82,254 C78,210 88,161 120,124 C152,87 200,70 250,70 Z"/>
            <path fill="#030E0A"
              d="M250,82 C296,82 340,98 370,132 C400,166 410,212 406,254 C402,296 390,332 372,358 C354,384 332,404 310,422 C294,434 272,446 260,453 C255,456 252,457 250,458 C248,457 245,456 240,453 C228,446 206,434 190,422 C168,404 146,384 128,358 C110,332 98,296 94,254 C90,212 100,166 130,132 C160,98 204,82 250,82 Z"/>
            <path fill="url(#ls-sinner)"
              d="M250,92 C294,92 336,107 364,139 C392,171 402,214 398,254 C394,294 382,328 365,354 C348,380 327,400 306,417 C291,429 270,440 260,447 C255,449 252,451 250,451 C248,451 245,449 240,447 C230,440 209,429 194,417 C173,400 152,380 135,354 C118,328 106,294 102,254 C98,214 108,171 136,139 C164,107 206,92 250,92 Z"/>
            {/* Shield tip */}
            <path fill="#030E0A"
              d="M234,476 L250,540 L266,476 C260,480 255,483 250,485 C245,483 240,480 234,476 Z"/>
            <path fill="url(#ls-sgold)"
              d="M238,478 L250,534 L262,478 C257,481 253,483 250,484 C247,483 243,481 238,478 Z"/>
            <line x1="250" y1="490" x2="250" y2="530" stroke="#030E0A" strokeWidth="4"/>
            <line x1="250" y1="492" x2="250" y2="528" stroke="url(#ls-sgold)" strokeWidth="2" opacity="0.6"/>
          </Emerge>

          {/* ── DISCIPLINE MARKS — bloom at 1.4s beat ── */}
          {([
            { key: 'mul', origin: '153px 137px',
              dark: 'M134,136 L156,118 L170,134 L162,152 L140,156 Z',
              gold: 'M136,138 L156,121 L168,136 L161,151 L141,154 Z',
              lx1: 148, ly1: 134, lx2: 158, ly2: 148 },
            { key: 'mur', origin: '347px 137px',
              dark: 'M366,136 L344,118 L330,134 L338,152 L360,156 Z',
              gold: 'M364,138 L344,121 L332,136 L339,151 L359,154 Z',
              lx1: 352, ly1: 134, lx2: 342, ly2: 148 },
            { key: 'mml', origin: '97px 237px',
              dark: 'M80,234 L100,218 L114,236 L106,256 L82,258 Z',
              gold: 'M82,236 L100,221 L112,237 L105,254 L84,256 Z',
              lx1: 94, ly1: 232, lx2: 104, ly2: 250 },
            { key: 'mmr', origin: '403px 237px',
              dark: 'M420,234 L400,218 L386,236 L394,256 L418,258 Z',
              gold: 'M418,236 L400,221 L388,237 L395,254 L416,256 Z',
              lx1: 406, ly1: 232, lx2: 396, ly2: 250 },
            { key: 'mll', origin: '123px 363px',
              dark: 'M106,360 L128,346 L140,364 L130,382 L108,380 Z',
              gold: 'M108,362 L128,349 L138,365 L129,380 L110,378 Z',
              lx1: 120, ly1: 358, lx2: 130, ly2: 374 },
            { key: 'mlr', origin: '377px 363px',
              dark: 'M394,360 L372,346 L360,364 L370,382 L392,380 Z',
              gold: 'M392,362 L372,349 L362,365 L371,380 L390,378 Z',
              lx1: 380, ly1: 358, lx2: 370, ly2: 374 },
          ] as const).map(m => (
            <g key={m.key} style={{
              animation: 'loading-marks-bloom 0.35s cubic-bezier(0.34,1.56,0.64,1) 1.4s both',
              transformOrigin: m.origin,
            }}>
              <path fill="#030E0A" d={m.dark}/>
              <path fill="url(#ls-sgold)" d={m.gold}/>
              <line x1={m.lx1} y1={m.ly1} x2={m.lx2} y2={m.ly2} stroke="#030E0A" strokeWidth="3"/>
            </g>
          ))}

          {/* ── BOSS RING — traces at 1.7s ── */}
          <Emerge delay="1.65s">
            <circle cx="250" cy="255" r="108" fill="#030E0A"/>
            <circle cx="250" cy="255" r="100" fill="url(#ls-sinner)"/>
            <circle cx="250" cy="252" r="100" fill="url(#ls-sbody)" opacity="0.5"/>
          </Emerge>

          {/* Boss dark ring trace */}
          <TracedCircle cx={250} cy={255} r={100} stroke="#030E0A" strokeWidth={16} delay="1.7s" />
          {/* Boss gold ring trace — 0.1s behind */}
          <TracedCircle cx={250} cy={255} r={100} stroke="url(#ls-sgold)" strokeWidth={8} delay="1.8s" />

          <Emerge delay="2.35s" duration="0.2s">
            <circle cx="250" cy="255" r="90" fill="none" stroke="#020806" strokeWidth="8"/>
            <circle cx="250" cy="255" r="84" fill="#020A08"/>
            {/* Archway horizontal marks */}
            <rect x="148" y="252" width="60" height="8" rx="3" fill="#030E0A"/>
            <rect x="150" y="253" width="56" height="6" rx="2" fill="url(#ls-sgold)" opacity="0.75"/>
            <rect x="292" y="252" width="60" height="8" rx="3" fill="#030E0A"/>
            <rect x="294" y="253" width="56" height="6" rx="2" fill="url(#ls-sgold)" opacity="0.75"/>
          </Emerge>

          {/* ── EYE — fills emerge then teal trace draws over at 2.1s ── */}
          <Emerge delay="2.1s" duration="0.5s">
            <path fill="#020A08"
              d="M250,192 C262,192 276,204 284,222 C292,240 294,260 290,278 C286,296 276,312 264,320 C258,324 254,326 250,326 C246,326 242,324 236,320 C224,312 214,296 210,278 C206,260 208,240 216,222 C224,204 238,192 250,192 Z"/>
            <path fill="url(#ls-seye)"
              d="M250,196 C261,196 274,207 282,224 C290,241 292,260 288,277 C284,294 275,309 264,317 C258,321 254,323 250,323 C246,323 242,321 236,317 C225,309 216,294 212,277 C208,260 210,241 218,224 C226,207 239,196 250,196 Z"/>
          </Emerge>

          {/* Teal eye trace stroke */}
          <path
            pathLength={1000}
            fill="none" stroke="#42D0AA" strokeWidth={3}
            d={EYE_OUTLINE}
            style={{
              strokeDasharray: DASH,
              strokeDashoffset: DASH,
              animation: 'trace-draw 0.55s cubic-bezier(0.4,0,0.2,1) 2.1s both',
            }}
          />

          <Emerge delay="2.55s" duration="0.25s">
            <path fill="none" stroke="#020A08" strokeWidth="12"
              d="M250,212 C259,212 270,221 276,236 C282,251 283,267 279,280 C275,293 268,303 260,308 C255,311 252,312 250,312 C248,312 245,311 240,308 C232,303 225,293 221,280 C217,267 218,251 224,236 C230,221 241,212 250,212 Z"/>
            <path fill="#061E16"
              d="M250,218 C258,218 268,226 273,239 C278,252 279,266 275,278 C271,290 264,299 257,303 C254,305 252,306 250,306 C248,306 246,305 243,303 C236,299 229,290 225,278 C221,266 222,252 227,239 C232,226 242,218 250,218 Z"/>
          </Emerge>

          {/* ── CENTER DOT — ignites at 2.65s ── */}
          <Emerge delay="2.6s" duration="0.2s">
            <circle cx="250" cy="259" r="30" fill="#020A08"/>
          </Emerge>
          <circle cx="250" cy="259" r="24" fill="url(#ls-sgold)"
            style={{
              animation: 'loading-dot-ignite 0.4s cubic-bezier(0.34,1.56,0.64,1) 2.65s both',
              transformOrigin: '250px 259px',
              opacity: 0,
            }}
          />
          <Emerge delay="2.72s" duration="0.15s">
            <circle cx="250" cy="259" r="16" fill="#020A08"/>
            <circle cx="250" cy="259" r="10" fill="#1A5A40"/>
            <circle cx="250" cy="259" r="5"  fill="#020A08"/>
          </Emerge>
          <circle cx="250" cy="259" r="3" fill="#EAC460"
            style={{
              animation: 'loading-dot-ignite 0.3s cubic-bezier(0.34,1.56,0.64,1) 2.8s both',
              transformOrigin: '250px 259px',
              opacity: 0,
            }}
          />
        </svg>
      </div>
    </div>
  )
}
