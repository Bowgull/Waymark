// Run: tsx src/lib/sessionNotes.test.ts
// Finishing a session never wipes its notes (D12).
import { isRunTag, notesOnComplete, userNotesFrom } from './sessionNotes'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

// The finish screen sends '' when nothing was typed.
assert(notesOnComplete('Felt strong on the last set.', '').notes === 'Felt strong on the last set.', 'an empty note on finish keeps the notes already there')
assert(notesOnComplete(null, '').notes === null && notesOnComplete(null, '').userNotes === null, 'nothing written, nothing there: stays empty')
const run = notesOnComplete('progression', 'Calves tight at the end.')
assert(run.notes === 'progression' && run.userNotes === 'Calves tight at the end.', 'a run keeps its category tag; the note goes to userNotes')
assert(notesOnComplete('zone2', undefined).notes === 'zone2' && isRunTag('zone2') && !isRunTag('Zone 2 felt easy'), 'zone2 tag survives a finish with no note')
const strength = notesOnComplete(null, 'Back a bit stiff.')
assert(strength.notes === 'Back a bit stiff.' && strength.userNotes === 'Back a bit stiff.', 'other sessions: the note lands in the column and userNotes')

assert(userNotesFrom({ notes: 'progression', contextJson: JSON.stringify({ userNotes: 'Sharp pain down my left leg.' }) }) === 'Sharp pain down my left leg.', 'userNotes wins over a run tag')
assert(userNotesFrom({ notes: 'zone2', contextJson: null }) === null, 'a bare run tag is not a note')
assert(userNotesFrom({ notes: 'Knee fine.', contextJson: 'not json' }) === 'Knee fine.', 'older rows: the column is the note')

console.log('session notes tests passed')
