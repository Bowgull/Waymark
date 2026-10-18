import { anthropicCall, getStructuredOutput, jsonFormatFor, type AnthropicResult, type Tool } from './anthropic'
import { MODELS } from './models'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

// ─── jsonFormatFor ──────────────────────────────────────────────

const tool: Tool = {
  name: 't',
  description: 'd',
  input_schema: {
    type: 'object',
    properties: {
      list: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'object', properties: { n: { type: 'integer', minimum: 0 } }, required: ['n'] },
      },
      note: { type: 'string', maxLength: 140, description: 'kept' },
    },
    required: ['list'],
  },
}
// Walks a JSON path through the generated schema.
const at = (...path: string[]): unknown => path.reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], jsonFormatFor(tool).schema)
assert(jsonFormatFor(tool).type === 'json_schema', 'format type is json_schema')
assert(at('additionalProperties') === false, 'root object gets additionalProperties false')
assert(at('properties', 'list', 'items', 'additionalProperties') === false, 'nested object gets additionalProperties false')
assert(at('properties', 'list', 'minItems') === undefined && at('properties', 'list', 'maxItems') === undefined, 'array limits dropped')
assert(at('properties', 'list', 'items', 'properties', 'n', 'minimum') === undefined, 'number limits dropped')
assert(at('properties', 'note', 'maxLength') === undefined && at('properties', 'note', 'description') === 'kept', 'string limits dropped, descriptions kept')
assert(JSON.stringify(at('required')) === '["list"]', 'required kept')
assert((tool.input_schema.properties.list as { minItems?: number }).minItems === 3, 'original tool schema untouched')

// ─── getStructuredOutput ────────────────────────────────────────

const ok = (text: string, stop: 'end_turn' | 'max_tokens' = 'end_turn'): AnthropicResult => ({
  offline: false, id: 'x', model: MODELS.reasoning, stop_reason: stop,
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
  usage: { input_tokens: 1, output_tokens: 1 },
})
assert(getStructuredOutput<{ a: number }>(ok('{"a":1}'))?.a === 1, 'parses JSON after a thinking block')
assert(getStructuredOutput(ok('{"a":')) === null, 'invalid JSON -> null')
assert(getStructuredOutput(ok('{"a":1}', 'max_tokens')) === null, 'truncated reply -> null')
assert(getStructuredOutput({ offline: true, content: null }) === null, 'offline -> null')

// ─── anthropicCall failure paths all return offline ─────────────

const realFetch = globalThis.fetch
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
async function callWith(f: () => Promise<Response>): Promise<{ result: AnthropicResult; calls: number; headers: Headers | null }> {
  let calls = 0
  let headers: Headers | null = null
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls++
    headers = new Headers(init?.headers)
    return f()
  }) as typeof fetch
  try {
    const result = await anthropicCall('key', { model: MODELS.reasoning, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }], fallbacks: 'default' })
    return { result, calls, headers }
  } finally {
    globalThis.fetch = realFetch
  }
}

const silence = console.error
const silenceWarn = console.warn
console.error = () => {}
console.warn = () => {}
const results: Array<[string, boolean]> = []
{
  const r = await callWith(async () => respond(400, { error: 'bad' }))
  results.push(['400 -> offline, no retry', r.result.offline && r.calls === 1])
  results.push(['fallbacks sends the fallback beta header', r.headers?.get('anthropic-beta') === 'server-side-fallback-2026-07-01'])
}
{
  const r = await callWith(async () => respond(404, { error: 'unknown model' }))
  results.push(['404 (unknown model) -> offline', r.result.offline])
}
{
  const r = await callWith(async () => respond(529, { error: 'overloaded' }))
  results.push(['529 -> one retry, then offline', r.result.offline && r.calls === 2])
}
{
  const r = await callWith(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) })
  results.push(['timeout -> one retry, then offline', r.result.offline && r.calls === 2])
}
{
  const r = await callWith(async () => respond(200, { id: 'x', model: MODELS.reasoning, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' }, usage: { input_tokens: 1, output_tokens: 0 } }))
  results.push(['refusal -> offline', r.result.offline])
}
{
  const r = await callWith(async () => respond(200, { id: 'x', model: 'claude-sonnet-5', content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
  results.push(['success returns the model that answered', !r.result.offline && r.result.model === 'claude-sonnet-5'])
}
console.error = silence
console.warn = silenceWarn
for (const [msg, pass] of results) assert(pass, msg)

console.log('\nAll anthropic tests passed')
