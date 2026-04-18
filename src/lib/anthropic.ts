const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const RETRY_DELAY_MS = 1_000
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529])

export type AnthropicModel = 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6'

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

export interface ToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export type ContentBlock = TextContent | ThinkingContent | ToolUseContent

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

export interface AnthropicRequest {
  model: AnthropicModel
  max_tokens: number
  system?: SystemBlock[]
  messages: Message[]
  tools?: Tool[]
  tool_choice?: { type: 'tool'; name: string } | { type: 'auto' } | { type: 'any' }
  thinking?: { type: 'enabled'; budget_tokens: number }
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
  content: ContentBlock[]
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: AnthropicUsage
}

export interface AnthropicOffline {
  offline: true
  content: null
}

export type AnthropicResult = AnthropicResponse | AnthropicOffline

function buildHeaders(model: AnthropicModel, apiKey: string): Record<string, string> {
  const betas: string[] = ['prompt-caching-2024-07-31']
  if (model === 'claude-sonnet-4-6') {
    betas.push('interleaved-thinking-2025-05-14')
  }
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': betas.join(','),
  }
}

function logUsage(model: AnthropicModel, usage: AnthropicUsage): void {
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

export async function anthropicCall(
  apiKey: string,
  req: AnthropicRequest
): Promise<AnthropicResult> {
  const headers = buildHeaders(req.model, apiKey)
  const body = JSON.stringify(req)

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers,
        body,
      })

      if (res.ok) {
        const data = (await res.json()) as Omit<AnthropicResponse, 'offline'>
        logUsage(req.model, data.usage)
        return { ...data, offline: false }
      }

      const errBody = await res.text().catch(() => '')
      console.error(`[anthropic] ${res.status} ${errBody}`)

      if (RETRYABLE_STATUSES.has(res.status) && attempt === 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }

      throw new Error(`Anthropic ${res.status}: ${errBody}`)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Anthropic ')) throw err

      if (attempt === 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }

      console.error('[anthropic] network failure, returning offline fallback')
      return { offline: true, content: null }
    }
  }

  console.error('[anthropic] retries exhausted, returning offline fallback')
  return { offline: true, content: null }
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
