import type { ProviderConfig } from '../../shared/domain'

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ProviderResponse { content: string; model: string; inputTokens?: number; outputTokens?: number }

export class ProviderService {
  async complete(config: ProviderConfig, apiKey: string, messages: ChatMessage[], signal?: AbortSignal): Promise<ProviderResponse> {
    const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.2 }),
      signal
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`Provider request failed (${response.status}): ${detail || response.statusText}`)
    }
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      model?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('Provider returned an empty response')
    return { content, model: payload.model ?? config.model, inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens }
  }

  async test(config: ProviderConfig, apiKey: string): Promise<void> {
    await this.complete(config, apiKey, [{ role: 'user', content: 'Reply with OK.' }], AbortSignal.timeout(20_000))
  }
}
