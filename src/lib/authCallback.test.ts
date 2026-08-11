import { expect, it } from 'vitest'

import { parseAuthCallbackType } from './authCallback'

it('accepts only the three Supabase authentication callback types', () => {
  expect(parseAuthCallbackType('signup')).toBe('signup')
  expect(parseAuthCallbackType('recovery')).toBe('recovery')
  expect(parseAuthCallbackType('email_change')).toBe('email_change')
  expect(parseAuthCallbackType('magiclink')).toBeNull()
  expect(parseAuthCallbackType('__proto__')).toBeNull()
  expect(parseAuthCallbackType(null)).toBeNull()
})
