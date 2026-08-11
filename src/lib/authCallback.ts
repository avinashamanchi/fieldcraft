export type AuthCallbackType = 'signup' | 'recovery' | 'email_change'

const AUTH_CALLBACK_TYPES = new Set<AuthCallbackType>(['signup', 'recovery', 'email_change'])

export const parseAuthCallbackType = (value: string | null): AuthCallbackType | null => (
  value !== null && AUTH_CALLBACK_TYPES.has(value as AuthCallbackType)
    ? value as AuthCallbackType
    : null
)
