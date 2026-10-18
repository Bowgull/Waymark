// The Claude models Waymark uses. Change a model here, nowhere else.
//   reasoning: Block Zero assessment/transition, reactive replan, replace suggestions.
//   fast: week plan, ledger insights, bag prescription, session review, summarizer.
export const MODELS = {
  reasoning: 'claude-sonnet-5-5',
  fast: 'claude-haiku-5-5',
} as const

export type WaymarkModel = (typeof MODELS)[keyof typeof MODELS]
