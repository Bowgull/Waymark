// The tab bar's painted icons (page 42, option A, approved): the world's places,
// modelled in the session icons' look (icon3d.js, toon, faint texture), rendered
// once to 192 px PNGs like the session icons (see README.md).
//   Today: the lantern · Program: the notched waypost · Library: the stone rune arch · Ledger: the lily pond

import arch from './assets/tab-arch.png'
import lantern from './assets/tab-lantern.png'
import lilypond from './assets/tab-lilypond.png'
import waypost from './assets/tab-waypost.png'

export const TAB_ICON_SRC = { today: lantern, program: waypost, library: arch, ledger: lilypond } as const
export type TabKey = keyof typeof TAB_ICON_SRC
