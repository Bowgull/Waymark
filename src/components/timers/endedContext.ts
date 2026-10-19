import { createContext } from 'react'

/**
 * True once the × has been held through (page 19 `.xbtn`): the screen flips its
 * phase word to ENDED in place and stops counting, then the session leaves.
 */
export const SessionEndedContext = createContext(false)
