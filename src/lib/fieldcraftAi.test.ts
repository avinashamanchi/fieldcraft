import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })) } },
}))

import { AI_CONSENT_VERSION, createFieldCraftAiClient } from './fieldcraftAi'

const response = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
}) as Response

describe('FieldCraft web AI boundary', () => {
  it('requires consent and session before fetch', async () => {
    const fetcher = vi.fn()
    const client = createFieldCraftAiClient({
      functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai', fetcher,
      getAccessToken: async () => 'token', hasConsent: () => false,
    })
    await expect(client.categorizeExpense('Vendor', 1200, 'notes')).rejects.toThrow(/consent/i)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses the Supabase token and never references a provider hostname or key', async () => {
    const fetcher = vi.fn(async () => response({
      route: 'expense.categorize.v1', version: 1, result: { category: 'Materials' },
    }))
    const client = createFieldCraftAiClient({
      functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai', fetcher,
      getAccessToken: async () => 'session-token', hasConsent: () => true,
    })
    await expect(client.categorizeExpense('Vendor', 12.34, 'notes')).resolves.toEqual({ category: 'Materials' })
    const call = JSON.stringify(fetcher.mock.calls)
    expect(call).toContain('Bearer session-token')
    expect(call).toContain(AI_CONSENT_VERSION)
    expect(call).not.toMatch(/groq|api[_-]?key/i)
  })

  it('does not expose an upstream body in UI errors', async () => {
    const marker = 'PRIVATE_PROVIDER_BODY'
    const client = createFieldCraftAiClient({
      functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai',
      fetcher: async () => ({ ok: false, status: 502, text: async () => marker }) as Response,
      getAccessToken: async () => 'token', hasConsent: () => true,
    })
    const error = await client.draftMessage('Update', 'Professional').catch((cause: unknown) => cause)
    expect(String(error)).not.toContain(marker)
  })

  it('enforces the deadline while a response body is still being read', async () => {
    const client = createFieldCraftAiClient({
      functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai',
      fetcher: async () => ({ ok: true, status: 200, body: null, text: () => new Promise(() => undefined) }) as Response,
      getAccessToken: async () => 'token', hasConsent: () => true, deadlineMs: 5,
    })
    await expect(client.draftMessage('Update', 'Professional')).rejects.toThrow(/timed out/i)
  })

  it('collapses malformed provider data to a stable public error', async () => {
    const marker = 'PRIVATE_MALFORMED_VALUE'
    const client = createFieldCraftAiClient({
      functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai',
      fetcher: async () => response({ route: 'message.draft.v1', version: 1, result: { message: marker.repeat(500) } }),
      getAccessToken: async () => 'token', hasConsent: () => true,
    })
    const error = await client.draftMessage('Update', 'Professional').catch((cause: unknown) => cause)
    expect(String(error)).toContain('invalid response')
    expect(String(error)).not.toContain(marker)
  })
})
