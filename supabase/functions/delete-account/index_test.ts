import { createDeleteAccountHandler, createProductionDeleteAccountHandler } from './index.ts'

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const make = (overrides: Record<string, unknown> = {}) => {
  const deleted: string[] = []
  const logs: unknown[] = []
  const handler = createDeleteAccountHandler({
    allowedOrigins: new Set(['https://app.example']),
    authenticateRequest: async () => ({ userId: '70000000-0000-0000-0000-000000000014' }),
    deleteLogo: async (id) => { deleted.push(`logo:${id}`) },
    deleteUser: async (id) => { deleted.push(`user:${id}`) },
    log: (entry) => logs.push(entry),
    ...overrides,
  })
  return { handler, deleted, logs }
}

Deno.test('requires POST, authentication, and an exact empty request', async () => {
  const unauthorized = make({ authenticateRequest: async () => { throw new Error('unauthorized') } }).handler
  assert((await unauthorized(new Request('https://edge.example', { method: 'POST', body: '{}' }))).status === 401, 'auth')
  const { handler } = make()
  assert((await handler(new Request('https://edge.example'))).status === 405, 'method')
  assert((await handler(new Request('https://edge.example', { method: 'POST', body: '{"userId":"other"}' }))).status === 400, 'body')
})

Deno.test('deletes only the authenticated owner logo and auth user', async () => {
  const { handler, deleted, logs } = make()
  const response = await handler(new Request('https://edge.example', { method: 'POST', body: '{}' }))
  const body = await response.json()
  assert(response.status === 200 && body.status === 'deleted' && typeof body.requestId === 'string', 'response')
  assert(deleted.join(',') === 'logo:70000000-0000-0000-0000-000000000014,user:70000000-0000-0000-0000-000000000014', 'identity')
  assert(!JSON.stringify(logs).includes('70000000-0000-0000-0000-000000000014'), 'user ID logged')
})

Deno.test('keeps failures content-free and refuses incomplete production configuration', async () => {
  const marker = 'PRIVATE_DELETE_FAILURE'
  const { handler } = make({ deleteLogo: async () => { throw new Error(marker) } })
  const response = await handler(new Request('https://edge.example', { method: 'POST', body: '{}' }))
  assert(response.status === 503 && !(await response.text()).includes(marker), 'private error')
  let configurationFailed = false
  try { createProductionDeleteAccountHandler({}) } catch { configurationFailed = true }
  assert(configurationFailed, 'configuration')
})
