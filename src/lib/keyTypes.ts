// The key session types: the ones that count as training (F15). Completion,
// the end gate, the Consistency board, the starter status, the guardrails'
// "hard" sessions and every coach rule read this one set. Foundation and
// recovery are habits, not doses. No imports, so anything can use it.
// Bag Conditioning (page 93) is training too: the coach places it as a session.
export const KEY_TYPES: ReadonlySet<string> = new Set(['strength', 'foundation_run', 'running', 'skip_rope', 'bag_work', 'mt_class', 'bag_conditioning'])
