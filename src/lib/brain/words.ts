// The coach's word rules, shared by every line it writes (page 56 voice,
// coach-brain.md §11) and by the notebook's claims. Pure.

/** Banned in any coach line (page 56 voice, §11) and the filler Josh asked to keep out. */
export const BANNED = /\b(load|loads|trend|trending|acwr|readiness score|coach read|you missed|building week|great job|great work|well done|nice work|crush|crushing|smash|journey|listen to your body|got this|keep it up|let'?s|amazing|awesome|proud|beast|warrior|unleash|no excuses|lazy|should have|make up for|catch up|cram)\b/i

/** What happens in a class is the gym's call: a line may move or take off a class, never shape it. */
export const CLASS_CONTENT = /\b(class|classes|sparring|spar)\b[^.]*\b(light|lighter|easy|easier|technique|sit out|sit-out|drills?|pads|hard rounds|go easy|take it easy|half|intensity|clinch|skip the)\b|\b(light|lighter|easy|easier|technique only|sit out|go easy|take it easy)\b[^.]*\b(class|sparring)\b/i
