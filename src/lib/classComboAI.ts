// Class to combo (page 49): the coach reads "What you learned" and pulls out
// every combo, naming strikes only from the app's own technique list (the
// ones switched on in Settings). The fast model, a JSON reply in a fixed
// schema (structured outputs), then guardAiExtraction holds the answer to the
// rules: a strike that isn't known and on leaves its combo out, and nothing
// the note doesn't mention gets through. Offline, no key or a refusal: null,
// and the deterministic parser (parseCombos) carries on alone.

import { anthropicCall, getStructuredOutput, jsonFormatFor, jsonInstructionFor, system, type AnthropicRequest, type AnthropicResult, type Tool } from './anthropic'
import { guardAiExtraction, type AiComboOutput, type Extraction, type Technique } from './classCombos'
import { MODELS } from './models'

export const TOOL_CLASS_COMBOS: Tool = {
  name: 'classCombos',
  description:
    'Pull every combo out of an athlete\'s note from a Muay Thai class. A combo is two or more strikes ' +
    'thrown in a row. Name each strike exactly as it appears in the known technique list. A strike the ' +
    'note names that is not on the list goes in unknownStrikes, in the note\'s own words, and its combo is ' +
    'left out. A single strike on its own is not a combo. Drills that are not strikes (partner work, ' +
    'catching, footwork) are not combos. Never invent strikes the note does not mention.',
  input_schema: {
    type: 'object',
    properties: {
      combos: {
        type: 'array',
        description: 'Every combo in the note, in the order written. Each strike exactly as named in the known list.',
        items: {
          type: 'object',
          properties: {
            strikes: { type: 'array', items: { type: 'string' }, description: 'Two or more strikes, in order.' },
          },
          required: ['strikes'],
        },
      },
      unknownStrikes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Strikes or techniques the note names that are not on the known list, in the note\'s words, once each.',
      },
    },
    required: ['combos', 'unknownStrikes'],
  },
}

export function classComboPrompt(note: string, techniques: ReadonlyArray<Technique>, enabled: ReadonlySet<string>): string {
  const known = techniques.filter(t => enabled.has(t.category)).map(t => t.name)
  return [
    'Known techniques (the only strike names you may use):',
    known.join(', '),
    '',
    'The note from tonight\'s class:',
    '"""',
    note.slice(0, 2000),
    '"""',
    '',
    jsonInstructionFor(TOOL_CLASS_COMBOS),
  ].join('\n')
}

/** The request: the fast model, a JSON reply in the classCombos schema. */
export function classComboRequest(note: string, techniques: ReadonlyArray<Technique>, enabled: ReadonlySet<string>): AnthropicRequest {
  return {
    model: MODELS.fast,
    max_tokens: 1024,
    output_config: { format: jsonFormatFor(TOOL_CLASS_COMBOS) },
    system: [system('You read training notes for a Muay Thai athlete and list the combos in them. You only use the strike names you are given.')],
    messages: [{ role: 'user', content: classComboPrompt(note, techniques, enabled) }],
  }
}

/** The call, held to the rules. Null when the model can't be reached (the parser alone then). */
export async function extractClassCombosAI(
  apiKey: string,
  note: string,
  techniques: ReadonlyArray<Technique>,
  enabled: ReadonlySet<string>,
  call: (key: string, req: AnthropicRequest) => Promise<AnthropicResult> = anthropicCall,
): Promise<Extraction | null> {
  if (!note.trim()) return null
  const result = await call(apiKey, classComboRequest(note, techniques, enabled))
  if (result.offline) return null
  return guardAiExtraction(getStructuredOutput<AiComboOutput>(result), note, techniques, enabled)
}
