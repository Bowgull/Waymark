import type { WaymarkModel } from './models'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const RETRY_DELAY_MS = 1_000
const MAX_RETRY_AFTER_MS = 5_000
const DEFAULT_TIMEOUT_MS = 60_000
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529])
let missingKeyLogged = false

// Every call uses a model from lib/models.
export type AnthropicModel = WaymarkModel

export interface CacheControl {
  type: 'ephemeral'
}

export interface SystemBlock {
  type: 'text'
  text: string
  cache_control?: CacheControl
}

export interface TextContent {
  type: 'text'
  text: string
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
}

export interface RedactedThinkingContent {
  type: 'redacted_thinking'
  data: string
}

/** Marks a server-side fallback switch (Sonnet declined, another model continued). */
export interface FallbackContent {
  type: 'fallback'
}

export interface ToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export type ContentBlock = TextContent | ThinkingContent | RedactedThinkingContent | FallbackContent | ToolUseContent

export interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface Tool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface JsonOutputFormat {
  type: 'json_schema'
  schema: Record<string, unknown>
}

export interface AnthropicRequest {
  model: AnthropicModel
  max_tokens: number
  system?: SystemBlock[]
  messages: Message[]
  tools?: Tool[]
  // Sonnet 5.5 rejects forced tool_choice ('tool' / 'any'); use output_config.format there.
  tool_choice?: { type: 'tool'; name: string } | { type: 'auto' } | { type: 'any' }
  thinking?: { type: 'adaptive' }
  output_config?: { effort?: Effort; format?: JsonOutputFormat }
  /** Server-side refusal fallback (Sonnet 5.5 on the Claude API; Haiku 5.5 has none). */
  fallbacks?: 'default'
}

export interface CallOptions {
  /** Per-attempt timeout. Defaults to 60s. */
  timeoutMs?: number
}

export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export interface AnthropicResponse {
  offline: false
  id: string
  /** The model that actually answered (differs from the request after a fallback). */
  model: string
  content: ContentBlock[]
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'pause_turn' | 'refusal'
  stop_details?: { type: 'refusal'; category: string | null; explanation?: string } | null
  usage: AnthropicUsage
}

export interface AnthropicOffline {
  offline: true
  content: null
}

export type AnthropicResult = AnthropicResponse | AnthropicOffline

function buildHeaders(req: AnthropicRequest, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  }
  if (req.fallbacks) headers['anthropic-beta'] = FALLBACK_BETA
  return headers
}

function retryDelayMs(res: Response): number {
  const after = Number(res.headers.get('retry-after'))
  return Number.isFinite(after) && after > 0 ? Math.min(after * 1000, MAX_RETRY_AFTER_MS) : RETRY_DELAY_MS
}

const offline = (): AnthropicOffline => ({ offline: true, content: null })

function logUsage(model: string, usage: AnthropicUsage): void {
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  if (cacheRead > 0 || cacheWrite > 0) {
    console.log(
      `[anthropic] ${model} | in=${usage.input_tokens} out=${usage.output_tokens} cache_read=${cacheRead} cache_write=${cacheWrite}`
    )
  } else {
    console.log(
      `[anthropic] ${model} | in=${usage.input_tokens} out=${usage.output_tokens}`
    )
  }
}

// Every failure (no key, auth, bad request, unknown model, timeout, refusal, retries
// exhausted) returns the offline result, so callers fall back instead of erroring.
export async function anthropicCall(
  apiKey: string,
  req: AnthropicRequest,
  opts: CallOptions = {},
): Promise<AnthropicResult> {
  if (!apiKey) {
    if (!missingKeyLogged) {
      console.info('[anthropic] api key missing. Using offline fallback.')
      missingKeyLogged = true
    }
    return offline()
  }

  const headers = buildHeaders(req, apiKey)
  const body = JSON.stringify(req)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  for (let attempt = 0; attempt < 2; attempt++) {
    const last = attempt === 1
    let res: Response
    try {
      res = await fetch(ANTHROPIC_URL, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : 'network failure'
      console.error(`[anthropic] ${req.model} ${reason}${last ? ', returning offline fallback' : ', retrying'}`)
      if (last) return offline()
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
      continue
    }

    if (res.ok) {
      let data: Omit<AnthropicResponse, 'offline'>
      try {
        data = (await res.json()) as Omit<AnthropicResponse, 'offline'>
      } catch {
        console.error('[anthropic] unreadable response body, returning offline fallback')
        return offline()
      }
      const servedBy = data.model ?? req.model
      logUsage(servedBy, data.usage)
      if (data.stop_reason === 'refusal') {
        console.warn(`[anthropic] ${servedBy} declined (category=${data.stop_details?.category ?? 'none'}), returning offline fallback`)
        return offline()
      }
      if (data.stop_reason === 'max_tokens') {
        console.warn(`[anthropic] ${servedBy} hit max_tokens=${req.max_tokens}; output may be incomplete`)
      }
      return { ...data, offline: false }
    }

    const errBody = await res.text().catch(() => '')
    console.error(`[anthropic] ${req.model} ${res.status} ${errBody.slice(0, 500)}`)

    if (RETRYABLE_STATUSES.has(res.status) && !last) {
      await new Promise(r => setTimeout(r, retryDelayMs(res)))
      continue
    }
    return offline()
  }

  return offline()
}

export function cachedSystem(text: string): SystemBlock {
  return { type: 'text', text, cache_control: { type: 'ephemeral' } }
}

export function system(text: string): SystemBlock {
  return { type: 'text', text }
}

export function getToolInput<T>(result: AnthropicResult, toolName: string): T | null {
  if (result.offline || !result.content) return null
  const block = result.content.find(
    (b): b is ToolUseContent => b.type === 'tool_use' && b.name === toolName
  )
  return block ? (block.input as T) : null
}

export function getToolInputs<T>(result: AnthropicResult, toolName: string): T[] {
  if (result.offline || !result.content) return []
  return result.content
    .filter((b): b is ToolUseContent => b.type === 'tool_use' && b.name === toolName)
    .map(b => b.input as T)
}

// ─── Structured outputs ────────────────────────────────────────
// Sonnet 5.5 rejects forced tool use, so calls that only forced a tool to get JSON
// back now ask for a JSON reply in the tool's schema instead (output_config.format).

const UNSUPPORTED_SCHEMA_KEYS = new Set(['minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf', 'pattern'])

function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema)
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(k)) continue
    out[k] = k === 'properties' && v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, toStrictSchema(pv)]))
      : toStrictSchema(v)
  }
  if (out.type === 'object') out.additionalProperties = false
  return out
}

/** JSON reply format built from a tool's input schema. Array/number limits are dropped; check them in code. */
export function jsonFormatFor(tool: Tool): JsonOutputFormat {
  return { type: 'json_schema', schema: toStrictSchema(tool.input_schema) as Record<string, unknown> }
}

/** Prompt line that replaces "Call <tool>", so the tool's description still reaches the model. */
export function jsonInstructionFor(tool: Tool): string {
  return `Reply with only the ${tool.name} JSON object. ${tool.description}`
}

/** Parses the JSON reply of a structured-output call. Null when offline, truncated or unparseable. */
export function getStructuredOutput<T>(result: AnthropicResult): T | null {
  if (result.offline || !result.content) return null
  if (result.stop_reason === 'max_tokens') return null
  const text = result.content.filter((b): b is TextContent => b.type === 'text').map(b => b.text).join('')
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as T
  } catch {
    console.error('[anthropic] structured output was not valid JSON')
    return null
  }
}
