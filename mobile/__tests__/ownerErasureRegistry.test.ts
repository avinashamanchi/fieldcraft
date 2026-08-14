import * as SecureStore from 'expo-secure-store'

import { createOwnerErasureRegistry } from '../src/auth/ownerErasureRegistry'

it('stores the pending-erasure journal in the unlocked, device-only keychain class', async () => {
  const values = new Map<string, string>()
  const backend = {
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { values.set(key, value) }),
    deleteItemAsync: jest.fn(async (key: string) => { values.delete(key) }),
  }
  const registry = createOwnerErasureRegistry(backend)

  await registry.mark('123e4567-e89b-12d3-a456-426614174000')

  expect(backend.setItemAsync).toHaveBeenCalledWith(
    'fieldcraft.owner-erasure.v1',
    expect.any(String),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  )
})
