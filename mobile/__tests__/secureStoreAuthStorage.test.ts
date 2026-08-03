import {
  createSecureStoreAuthStorage,
  SecureAuthStorageError,
  type SecureStoreBackend,
} from '../src/auth/secureStoreAuthStorage'

class MemorySecureStore implements SecureStoreBackend {
  readonly values = new Map<string, string>()
  failGet = false
  failSet: ((key: string) => boolean) | null = null

  async getItemAsync(key: string): Promise<string | null> {
    if (this.failGet) throw new Error('keychain unavailable: provider-secret')
    return this.values.get(key) ?? null
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    if (this.failSet?.(key)) throw new Error('interrupted write: provider-secret')
    this.values.set(key, value)
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key)
  }
}

const sequentialGenerations = (...generations: string[]) => {
  let index = 0
  return () => generations[index++] ?? `generation-${index}`
}

it('round-trips values larger than 2 KiB through 1,800-code-unit chunks', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: () => 'large-value',
  })
  const value = `${'a'.repeat(2_050)}${'🙂'.repeat(1_500)}`

  await storage.setItem('session', value)

  await expect(storage.getItem('session')).resolves.toBe(value)
  const manifest = JSON.parse(backend.values.get('session.__manifest') ?? '{}')
  expect(manifest).toEqual({ version: 1, generation: 'large-value', chunks: 3 })
  expect(backend.values.get('session.__large-value.0')).toHaveLength(1_800)
  expect(backend.values.get('session.__large-value.1')).toHaveLength(1_800)
  expect(backend.values.get('session.__large-value.2')).toHaveLength(1_450)
})

it('keeps the prior generation readable and removes an interrupted replacement', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: sequentialGenerations('old', 'interrupted'),
  })
  await storage.setItem('session', 'known-good')
  backend.failSet = (key) => key === 'session.__interrupted.1'

  await expect(storage.setItem('session', 'x'.repeat(3_000))).rejects.toBeInstanceOf(
    SecureAuthStorageError,
  )

  await expect(storage.getItem('session')).resolves.toBe('known-good')
  expect([...backend.values.keys()].some((key) => key.includes('interrupted'))).toBe(false)
})

it('does not delete the prior generation when manifest replacement fails', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: sequentialGenerations('old', 'replacement'),
  })
  await storage.setItem('session', 'known-good')
  backend.failSet = (key) => key === 'session.__manifest'

  await expect(storage.setItem('session', 'replacement')).rejects.toBeInstanceOf(
    SecureAuthStorageError,
  )

  backend.failSet = null
  await expect(storage.getItem('session')).resolves.toBe('known-good')
  expect(backend.values.get('session.__old.0')).toBe('known-good')
  expect([...backend.values.keys()].some((key) => key.includes('replacement'))).toBe(false)
})

it('rejects a generation collision before overwriting committed chunks', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: () => 'same-generation',
  })
  await storage.setItem('session', 'known-good')

  await expect(storage.setItem('session', 'replacement')).rejects.toBeInstanceOf(
    SecureAuthStorageError,
  )

  await expect(storage.getItem('session')).resolves.toBe('known-good')
})

it('fails closed when a committed generation is missing a chunk', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: () => 'missing',
  })
  await storage.setItem('session', 'x'.repeat(3_000))
  backend.values.delete('session.__missing.1')

  await expect(storage.getItem('session')).rejects.toMatchObject({
    name: 'SecureAuthStorageError',
    message: 'Secure authentication storage is unavailable.',
  })
})

it('removes the manifest and every chunk idempotently', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: () => 'remove',
  })
  await storage.setItem('session', 'x'.repeat(4_000))

  await storage.removeItem('session')
  await storage.removeItem('session')

  await expect(storage.getItem('session')).resolves.toBeNull()
  expect([...backend.values.keys()].filter((key) => key.startsWith('session.'))).toEqual([])
})

it('serializes concurrent replacements so the later call wins without orphaned chunks', async () => {
  let releaseFirst!: () => void
  let markFirstStarted!: () => void
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve
  })
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  class PausingSecureStore extends MemorySecureStore {
    override async setItemAsync(key: string, value: string): Promise<void> {
      if (key === 'session.__first.0') {
        markFirstStarted()
        await firstRelease
      }
      await super.setItemAsync(key, value)
    }
  }
  const backend = new PausingSecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: sequentialGenerations('first', 'second'),
  })

  const first = storage.setItem('session', 'first')
  await firstStarted
  const second = storage.setItem('session', 'second')
  releaseFirst()
  await Promise.all([first, second])

  await expect(storage.getItem('session')).resolves.toBe('second')
  expect([...backend.values.keys()].some((key) => key.includes('__first.'))).toBe(false)
})

it('surfaces keychain failures without writing to plaintext browser storage', async () => {
  const backend = new MemorySecureStore()
  backend.failGet = true
  const storage = createSecureStoreAuthStorage({ backend })
  const plaintextFallback = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  }
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: plaintextFallback,
  })

  try {
    await expect(storage.getItem('session')).rejects.toMatchObject({
      name: 'SecureAuthStorageError',
      message: 'Secure authentication storage is unavailable.',
    })
    expect(plaintextFallback.getItem).not.toHaveBeenCalled()
    expect(plaintextFallback.setItem).not.toHaveBeenCalled()
    expect(plaintextFallback.removeItem).not.toHaveBeenCalled()
  } finally {
    if (previousLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage
    }
  }
})
