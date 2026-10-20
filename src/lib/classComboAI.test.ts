// Run: tsx src/lib/classComboAI.test.ts
// No real AI call: the model is a stand-in function; the empty-key path stops before any fetch.
import assert from 'node:assert/strict'

import type { AnthropicRequest, AnthropicResult } from './anthropic'
import { classComboRequest, extractClassCombosAI } from './classComboAI'
import { deriveTechniques } from './classCombos'
import { MODELS } from './models'

const TECH = deriveTechniques(['Jab → Cross → Hook', 'Lead Hook → Cross', 'Jab → Cross → Low Kick', 'Jab → Cross → Rear Knee', 'Jab → Jab → Teep'])
const ON = new Set(['boxing', 'kicks', 'defensive'])
const NOTE = 'Then jab, cross, lead hook on the pads. Superman punch drills. Jab, cross, rear knee to finish.'

const reply = (json: unknown): AnthropicResult => ({
  offline: false, id: 'm', model: MODELS.fast, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
  content: [{ type: 'text', text: JSON.stringify(json) }],
})

async function main() {
  // the request: the fast model, a structured JSON reply, only switched-on techniques offered
  const req = classComboRequest(NOTE, TECH, ON)
  assert.equal(req.model, MODELS.fast)
  assert.equal(req.output_config?.format?.type, 'json_schema')
  assert.equal(req.tool_choice, undefined, 'no forced tool: structured outputs')
  const prompt = String(req.messages[0].content)
  assert.ok(prompt.includes('Lead hook') && prompt.includes('Teep'))
  assert.ok(!prompt.includes('Rear knee'), 'knees are off in Settings: not offered')
  const schema = req.output_config!.format!.schema as { additionalProperties?: boolean }
  assert.equal(schema.additionalProperties, false)

  // the answer held to the rules
  let seen: AnthropicRequest | null = null
  const fake = async (_k: string, r: AnthropicRequest) => {
    seen = r
    return reply({ combos: [{ strikes: ['Jab', 'Cross', 'Lead hook'] }, { strikes: ['Jab', 'Cross', 'Rear knee'] }, { strikes: ['Jab', 'Spinning back fist'] }], unknownStrikes: ['superman punch'] })
  }
  const x = await extractClassCombosAI('test-key-not-real', NOTE, TECH, ON, fake)
  assert.ok(seen, 'the stand-in was called')
  assert.deepEqual(x?.combos, [{ strikes: ['Jab', 'Cross', 'Lead hook'] }])
  assert.deepEqual(x?.off, ['Rear knee'])
  assert.deepEqual(x?.unknown, ['Superman punch'], 'a strike the note never names is dropped')

  // offline, unreadable, or no key: null (the parser alone)
  assert.equal(await extractClassCombosAI('k', NOTE, TECH, ON, async () => ({ offline: true, content: null })), null)
  assert.equal(await extractClassCombosAI('k', NOTE, TECH, ON, async () => ({ ...reply({}), content: [{ type: 'text', text: '{oops' }] })), null)
  assert.equal(await extractClassCombosAI('', NOTE, TECH, ON), null, 'empty key: no fetch, null')
  assert.equal(await extractClassCombosAI('k', '   ', TECH, ON, async () => { throw new Error('must not call') }), null)

  console.log('classComboAI tests passed')
}

void main()
