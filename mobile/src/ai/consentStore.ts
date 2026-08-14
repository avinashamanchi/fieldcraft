import * as SecureStore from 'expo-secure-store'

import { AI_CONSENT_VERSION } from './contracts'

export type AiConsentStoreBackend = Pick<typeof SecureStore, 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'>
export type AiConsentStore = {
  grant(ownerId: string): Promise<void>
  hasConsent(ownerId: string): Promise<boolean>
  revoke(ownerId: string): Promise<void>
}

const keyFor = (ownerId: string): string => {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(ownerId)) throw new Error('AI consent owner is invalid')
  return `fieldcraft.ai-consent.${ownerId}`
}

export const createAiConsentStore = (backend: AiConsentStoreBackend = SecureStore): AiConsentStore => ({
  async grant(ownerId) {
    await backend.setItemAsync(keyFor(ownerId), AI_CONSENT_VERSION, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
  },
  async hasConsent(ownerId) { return await backend.getItemAsync(keyFor(ownerId)) === AI_CONSENT_VERSION },
  async revoke(ownerId) { await backend.deleteItemAsync(keyFor(ownerId)) },
})

export const aiConsentStore = createAiConsentStore()
