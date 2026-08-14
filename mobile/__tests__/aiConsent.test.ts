import * as SecureStore from 'expo-secure-store'

import { AI_CONSENT_VERSION } from '../src/ai/contracts'
import { createAiConsentStore } from '../src/ai/consentStore'

class Backend {
  values = new Map<string, string>()
  writeOptions: Array<Parameters<typeof SecureStore.setItemAsync>[2]> = []
  getItemAsync(key: string) { return Promise.resolve(this.values.get(key) ?? null) }
  setItemAsync(key: string, value: string, options?: Parameters<typeof SecureStore.setItemAsync>[2]) {
    this.writeOptions.push(options)
    this.values.set(key, value)
    return Promise.resolve()
  }
  deleteItemAsync(key: string) { this.values.delete(key); return Promise.resolve() }
}

it('requires the exact current consent version per owner', async () => {
  const backend = new Backend()
  const store = createAiConsentStore(backend)
  await expect(store.hasConsent('owner-a')).resolves.toBe(false)
  await store.grant('owner-a')
  await expect(store.hasConsent('owner-a')).resolves.toBe(true)
  expect([...backend.values.values()]).toEqual([AI_CONSENT_VERSION])
  expect(backend.writeOptions).toEqual([{
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }])
  await expect(store.hasConsent('owner-b')).resolves.toBe(false)
})

it('revokes consent without falling back to plaintext storage', async () => {
  const backend = new Backend()
  const store = createAiConsentStore(backend)
  await store.grant('owner-a')
  await store.revoke('owner-a')
  await expect(store.hasConsent('owner-a')).resolves.toBe(false)
})
