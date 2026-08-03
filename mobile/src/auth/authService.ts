import type { Session } from '@supabase/supabase-js'

import { getSupabaseClient } from './supabase'

export type AuthSession = {
  user: {
    id: string
    email: string
    emailConfirmedAt: string | null
  }
}

export class AuthOperationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthOperationError'
  }
}

type ProviderResult<T = unknown> = Promise<{ data: T; error: unknown | null }>

type AuthClientLike = {
  auth: {
    getSession?: () => ProviderResult<{ session: Session | null }>
    onAuthStateChange?: (
      callback: (event: string, session: Session | null) => void,
    ) => { data: { subscription: { unsubscribe(): void } } }
    startAutoRefresh?: () => Promise<void>
    stopAutoRefresh?: () => Promise<void>
    signInWithPassword?: (credentials: { email: string; password: string }) => ProviderResult
    signUp?: (credentials: {
      email: string
      password: string
      options: { emailRedirectTo: string }
    }) => ProviderResult<{ session: Session | null }>
    resetPasswordForEmail?: (email: string, options: { redirectTo: string }) => ProviderResult
    updateUser?: (attributes: { password: string }) => ProviderResult
    signOut?: () => ProviderResult
    exchangeCodeForSession?: (code: string) => ProviderResult
    verifyOtp?: (parameters: { token_hash: string; type: 'signup' | 'recovery' }) => ProviderResult
  }
}

export interface AuthService {
  getSession(): Promise<AuthSession | null>
  subscribe(listener: (session: AuthSession | null) => void): () => void
  startAutoRefresh(): Promise<void>
  stopAutoRefresh(): Promise<void>
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<{ verificationRequired: boolean }>
  requestPasswordReset(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
  signOut(): Promise<void>
  exchangeCode(code: string): Promise<void>
  verifySignup(tokenHash: string): Promise<void>
  recoverPassword(tokenHash: string): Promise<void>
}

const normalizeSession = (session: Session | null): AuthSession | null => {
  const email = session?.user.email
  if (!session || !email) return null
  return {
    user: {
      id: session.user.id,
      email,
      emailConfirmedAt: session.user.email_confirmed_at ?? null,
    },
  }
}

const requireMethod = <T extends (...args: never[]) => unknown>(
  method: T | undefined,
): T => {
  if (!method) throw new AuthOperationError('Authentication is temporarily unavailable.')
  return method
}

const callProvider = async <T>(
  operation: () => ProviderResult<T>,
  message: string,
): Promise<T> => {
  try {
    const { data, error } = await operation()
    if (error) throw new AuthOperationError(message)
    return data
  } catch (error) {
    if (error instanceof AuthOperationError) throw error
    throw new AuthOperationError(message)
  }
}

export const createAuthService = (client: AuthClientLike): AuthService => ({
  async getSession() {
    const method = requireMethod(client.auth.getSession)
    const data = await callProvider(
      () => method.call(client.auth),
      'Unable to restore your session. Please sign in again.',
    )
    return normalizeSession(data.session)
  },

  subscribe(listener) {
    try {
      const method = requireMethod(client.auth.onAuthStateChange)
      const { data } = method.call(client.auth, (_event, session) => listener(normalizeSession(session)))
      return () => data.subscription.unsubscribe()
    } catch {
      throw new AuthOperationError('Unable to observe authentication securely.')
    }
  },

  async startAutoRefresh() {
    try {
      await requireMethod(client.auth.startAutoRefresh).call(client.auth)
    } catch {
      throw new AuthOperationError('Unable to refresh authentication securely.')
    }
  },

  async stopAutoRefresh() {
    try {
      await requireMethod(client.auth.stopAutoRefresh).call(client.auth)
    } catch {
      throw new AuthOperationError('Unable to stop authentication refresh securely.')
    }
  },

  async signIn(email, password) {
    const method = requireMethod(client.auth.signInWithPassword)
    await callProvider(
      () => method.call(client.auth, { email, password }),
      'Unable to sign in. Check your details and try again.',
    )
  },

  async signUp(email, password) {
    const method = requireMethod(client.auth.signUp)
    const data = await callProvider(
      () => method.call(client.auth, {
        email,
        password,
        options: { emailRedirectTo: 'fieldcraft://auth/verify' },
      }),
      'Unable to create your account. Please try again.',
    )
    return {
      verificationRequired:
        data.session === null || data.session.user.email_confirmed_at == null,
    }
  },

  async requestPasswordReset(email) {
    const method = requireMethod(client.auth.resetPasswordForEmail)
    await callProvider(
      () => method.call(client.auth, email, { redirectTo: 'fieldcraft://auth/reset' }),
      'Unable to send a reset email. Please try again.',
    )
  },

  async updatePassword(password) {
    const method = requireMethod(client.auth.updateUser)
    await callProvider(
      () => method.call(client.auth, { password }),
      'Unable to update your password. Please try again.',
    )
  },

  async signOut() {
    const method = requireMethod(client.auth.signOut)
    await callProvider(
      () => method.call(client.auth),
      'Unable to sign out securely. Please try again.',
    )
  },

  async exchangeCode(code) {
    const method = requireMethod(client.auth.exchangeCodeForSession)
    await callProvider(
      () => method.call(client.auth, code),
      'Unable to complete sign in from this link.',
    )
  },

  async verifySignup(tokenHash) {
    const method = requireMethod(client.auth.verifyOtp)
    await callProvider(
      () => method.call(client.auth, { token_hash: tokenHash, type: 'signup' }),
      'Unable to verify this email link.',
    )
  },

  async recoverPassword(tokenHash) {
    const method = requireMethod(client.auth.verifyOtp)
    await callProvider(
      () => method.call(client.auth, { token_hash: tokenHash, type: 'recovery' }),
      'Unable to open this password reset link.',
    )
  },
})

let authService: AuthService | null = null

export const getAuthService = (): AuthService => {
  authService ??= createAuthService(getSupabaseClient() as unknown as AuthClientLike)
  return authService
}
