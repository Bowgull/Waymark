// The Claude models Waymark uses. Change a model here, nowhere else.
//   decision: the coach brain's one nightly call (coach-brain.md §5.3).
//   reasoning: Block Zero assessment/transition, replace suggestions.
//   fast: ledger insights, bag prescription, session review, summarizer.
export const MODELS = {
  decision: 'claude-opus-5-5',
  reasoning: 'claude-sonnet-5-5',
  fast: 'claude-haiku-5-5',
} as const

export type WaymarkModel = (typeof MODELS)[keyof typeof MODELS]
