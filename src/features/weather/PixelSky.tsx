import type { Sky } from './weatherData'

// The crisp pixel skies (page 72): 12 × 12, drawn by hand; gold sun, bone
// cloud, teal rain.
const PAL: Readonly<Record<string, string>> = { G: '#e8c878', g: '#a8843c', W: '#e4e6dc', w: '#8fa39a', T: '#7fd0b4', S: '#f4f1e6', M: '#e6d6a0', Y: '#f2d27a' }
const SKY: Readonly<Record<Sky, readonly string[]>> = {
  sun: ['.....GG.....', '..G..GG..G..', '...G....G...', '....GGGG....', '...GGGGGG...', 'GG.GGYYGG.GG', 'GG.GGYYGG.GG', '...GGGGGG...', '....GGGG....', '...G....G...', '..G..GG..G..', '.....GG.....'],
  moon: ['............', '.....MMM....', '...MMMM.....', '..MMMM......', '..MMM.......', '.MMMM.......', '.MMMM.......', '..MMM.......', '..MMMM....M.', '...MMMMMMM..', '.....MMMM...', '............'],
  part: ['..G..G......', '...GGGG.....', '.GGGGGGG.G..', '..GGGGG.....', '.GGGGWWW....', '..GGWWWWW...', '.G.WWWWWWWW.', '..WWWWWWWWWW', '.WWWWWWWWWWW', '.WWWWWWWWWWW', '..wwwwwwwww.', '............'],
  cloud: ['............', '............', '.....WWW....', '....WWWWW...', '..WWWWWWWW..', '.WWWWWWWWWW.', 'WWWWWWWWWWWW', 'WWWWWWWWWWWW', 'WWWWWWWWWWWW', '.wwwwwwwwww.', '............', '............'],
  rain: ['.....WWW....', '...WWWWWWW..', '.WWWWWWWWWW.', 'WWWWWWWWWWWW', 'WWWWWWWWWWWW', '.wwwwwwwwww.', '............', '..T...T...T.', '.T...T...T..', '............', '...T...T....', '..T...T.....'],
  snow: ['.....WWW....', '...WWWWWWW..', '.WWWWWWWWWW.', 'WWWWWWWWWWWW', 'WWWWWWWWWWWW', '.wwwwwwwwww.', '............', '..S....S....', '.SSS..SSS..S', '..S....S...S', '.....S......', '....SSS.....'],
  storm: ['.....WWW....', '...WWWWWWW..', '.WWWWWWWWWW.', 'WWWWWWWWWWWW', '.wwwwwwwwww.', '.....GG.....', '....GG...T..', '...GGGG.....', '.....GG..T..', '....GG......', '...G........', '............'],
  fog: ['............', '............', '.wwwwwwwww..', '............', '...wwwwwwwww', '............', 'wwwwwwwwww..', '............', '..wwwwwwwwww', '............', '.wwwwwwww...', '............'],
  partn: ['..MM........', '.MMM........', 'MMM.........', 'MMM..WWW....', '.MMMWWWWW...', '..WWWWWWWWW.', '.WWWWWWWWWWW', '.WWWWWWWWWWW', '..wwwwwwwww.', '............', '............', '............'],
}

export function PixelSky({ sky, size = 24, label }: { sky: Sky; size?: number; label?: string }) {
  const rows = SKY[sky] ?? SKY.cloud
  return (
    <svg className="wx-px" width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={PAL[c]} />)))}
    </svg>
  )
}
