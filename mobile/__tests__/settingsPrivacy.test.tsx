import { render, screen, userEvent } from '@testing-library/react-native'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { AiConsentControls } from '../app/settings/ai'

it('shows and explicitly grants or revokes versioned AI consent', async () => {
  let granted = false
  const store = {
    hasConsent: jest.fn(async () => granted),
    grant: jest.fn(async () => { granted = true }),
    revoke: jest.fn(async () => { granted = false }),
  }
  const user = userEvent.setup()
  render(<AiConsentControls ownerId="owner-a" store={store} />)
  expect(await screen.findByText(/AI access is off/i)).toBeTruthy()
  const grantButton = screen.getByTestId('grant-ai-consent')
  expect(grantButton.props.disabled).not.toBe(true)
  await user.press(grantButton)
  expect(store.grant).toHaveBeenCalledWith('owner-a')
  expect(await screen.findByText(/AI access is on/i)).toBeTruthy()
  await user.press(screen.getByTestId('revoke-ai-consent'))
  expect(await screen.findByText(/AI access is off/i)).toBeTruthy()
})

it('publishes matching privacy and support disclosures without tracking claims', () => {
  const privacy = readFileSync(resolve(__dirname, '../../public/privacy.html'), 'utf8')
  const support = readFileSync(resolve(__dirname, '../../public/support.html'), 'utf8')
  for (const disclosure of ['Supabase', 'offline cache', 'Groq', 'raw audio', 'raw receipt image', 'no tracking', 'Delete Account', 'invoice']) expect(privacy).toContain(disclosure)
  expect(support).toContain('FieldCraft Support')
})
