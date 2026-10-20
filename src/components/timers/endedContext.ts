import { createContext } from 'react'

/**
 * True once the × has been held through (page 19 `.xbtn`): the screen flips its
 * phase word to ENDED in place and stops counting, then the session leaves.
 */
export const SessionEndedContext = createContext(false)

/**
 * The open session's two ways off a screen (page 61, 3A): ‹ TODAY steps out
 * without ending (`leave`), holding × ends it (`end`). WorkoutPage sets them;
 * every SessionFrame reads them at the tap. Without them (a gallery) the
 * screen's own onEnd does both.
 */
export interface SessionNav { leave: () => void; end: () => void }
let currentNav: SessionNav | null = null
export function setSessionNav(nav: SessionNav | null): void { currentNav = nav }
export function getSessionNav(): SessionNav | null { return currentNav }
