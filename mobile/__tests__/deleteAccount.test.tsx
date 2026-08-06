import { act, fireEvent, render, screen } from '@testing-library/react-native'

import { DeleteAccountControl } from '../app/settings/delete-account'
import { createDeleteAccountClient } from '../src/privacy/deleteAccount'

it('requires authenticated HTTPS and maps auth failure without exposing a body', async () => {
  const marker = 'PRIVATE_DELETE_BODY'
  const client = createDeleteAccountClient({
    functionUrl: 'https://project.supabase.co/functions/v1/delete-account',
    getAccessToken: async () => 'token',
    fetcher: async () => ({ ok: false, status: 401, text: async () => marker }) as Response,
  })
  const error = await client.deleteAccount().catch((cause: unknown) => cause)
  expect(String(error)).not.toContain(marker)
  expect(error).toMatchObject({ reason: 'reauthentication' })
  expect(() => createDeleteAccountClient({ functionUrl: 'http://project.test/delete-account', getAccessToken: async () => 'token' })).toThrow(/HTTPS/i)
})

it('requires the exact phrase, suppresses duplicate taps, and reports partial local cleanup', async () => {
  let resolveCloud!: () => void
  const cloud = new Promise<void>((done) => { resolveCloud = done })
  const deleteCloud = jest.fn(() => cloud)
  const deleteLocal = jest.fn(async () => ({ ok: false as const, failed: ['artifacts' as const] }))
  render(<DeleteAccountControl deleteCloud={deleteCloud} deleteLocal={deleteLocal} />)
  fireEvent.changeText(screen.getByTestId('delete-account-phrase'), 'delete my account')
  expect(screen.getByTestId('confirm-delete-account').props.accessibilityState.disabled).toBe(true)
  fireEvent.changeText(screen.getByTestId('delete-account-phrase'), 'DELETE MY ACCOUNT')
  fireEvent.press(screen.getByTestId('confirm-delete-account'))
  fireEvent.press(screen.getByTestId('confirm-delete-account'))
  expect(deleteCloud).toHaveBeenCalledTimes(1)
  await act(async () => { resolveCloud(); await cloud; await Promise.resolve() })
  expect(await screen.findByText(/account was deleted, but local cleanup is incomplete/i)).toBeTruthy()
})
