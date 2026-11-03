import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentInputSchema, commandInputSchema, providerInputSchema } from '../src/shared/schemas'
import { ProviderService } from '../src/main/services/providerService'

afterEach(() => vi.restoreAllMocks())

describe('validated application inputs', () => {
  it('fills safe agent defaults and rejects invalid colors', () => {
    expect(agentInputSchema.parse({ name:'Agent', role:'Analyst' }).permissionProfile).toBe('standard')
    expect(() => agentInputSchema.parse({ name:'Agent', role:'Analyst', color:'red' })).toThrow()
  })

  it('requires HTTPS provider endpoints except loopback development', () => {
    expect(() => providerInputSchema.parse({ name:'Unsafe', type:'compatible', baseUrl:'http://example.com', model:'m' })).toThrow('HTTPS')
    expect(providerInputSchema.parse({ name:'Local', type:'compatible', baseUrl:'http://localhost:11434/v1', model:'m' }).baseUrl).toContain('localhost')
  })

  it('rejects empty and oversized commands at the IPC boundary', () => {
    expect(() => commandInputSchema.parse({ message:'   ' })).toThrow()
    expect(() => commandInputSchema.parse({ message:'x'.repeat(40_001) })).toThrow()
  })
})

describe('provider isolation', () => {
  it('turns provider failures into scoped errors without leaking the API key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"unavailable"}', { status:503 })))
    const service = new ProviderService()
    const request = service.complete({ id:'1', name:'Test', type:'compatible', baseUrl:'https://example.com/v1', model:'model', hasCredential:true, enabled:true }, 'top-secret-key', [{ role:'user', content:'hello' }])
    await expect(request).rejects.toThrow('503')
    await expect(request).rejects.not.toThrow('top-secret-key')
  })

  it('bounds stalled provider requests with a user-facing timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise((_resolve,reject) => {
      init?.signal?.addEventListener('abort',() => reject(new DOMException('aborted','AbortError')),{ once:true })
    })))
    const service = new ProviderService(5)
    await expect(service.complete({ id:'1', name:'Test', type:'compatible', baseUrl:'https://example.com/v1', model:'model', hasCredential:true, enabled:true }, 'secret', [{ role:'user', content:'hello' }])).rejects.toThrow('timed out')
  })
})
