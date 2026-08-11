import { z } from 'zod'

import { getSupabaseClient } from '../auth/supabase'
import { validateSupabaseFunctionUrl } from '../network/supabaseFunctionUrl'

export type DeleteAccountErrorReason = 'invalid-response' | 'reauthentication' | 'timeout' | 'transient'
export class DeleteAccountError extends Error {
  constructor(readonly reason: DeleteAccountErrorReason) {
    super('FieldCraft could not delete the account.')
    this.name = 'DeleteAccountError'
  }
}

type DeleteAccountClientOptions = {
  deadlineMs?: number
  fetcher?: typeof fetch
  functionUrl: string
  getAccessToken(): Promise<string | null>
}

const ResponseSchema = z.object({ requestId: z.uuid(), status: z.literal('deleted') }).strict()

const validateUrl = (value: string): string => {
  return validateSupabaseFunctionUrl(value, 'delete-account', 'Account deletion requires an HTTPS function URL.')
}

export const createDeleteAccountClient = (options: DeleteAccountClientOptions) => {
  const functionUrl = validateUrl(options.functionUrl)
  return { async deleteAccount(): Promise<void> {
    const token = await options.getAccessToken()
    if (!token) throw new DeleteAccountError('reauthentication')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, options.deadlineMs ?? 15_000)
    try {
      const response = await (options.fetcher ?? fetch)(functionUrl, {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      const body = await Promise.race([
        response.text(),
        new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new DeleteAccountError('timeout')), { once: true })),
      ])
      if (new TextEncoder().encode(body).byteLength > 16 * 1024) throw new DeleteAccountError('invalid-response')
      if (response.status === 401 || response.status === 403) throw new DeleteAccountError('reauthentication')
      if (!response.ok) throw new DeleteAccountError('transient')
      let parsed: unknown
      try { parsed = JSON.parse(body) } catch { throw new DeleteAccountError('invalid-response') }
      if (!ResponseSchema.safeParse(parsed).success) throw new DeleteAccountError('invalid-response')
    } catch (cause) {
      if (cause instanceof DeleteAccountError) throw cause
      throw new DeleteAccountError(timedOut ? 'timeout' : 'transient')
    } finally {
      clearTimeout(timer)
    }
  } }
}

export const getDeleteAccountClient = () => createDeleteAccountClient({
  functionUrl: `${process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ?? ''}/functions/v1/delete-account`,
  async getAccessToken() {
    const { data, error } = await getSupabaseClient().auth.getSession()
    return error ? null : data.session?.access_token ?? null
  },
})
