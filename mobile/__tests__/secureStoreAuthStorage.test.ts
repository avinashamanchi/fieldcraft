import {
  createSecureStoreAuthStorage,
  SecureAuthStorageError,
  type SecureStoreBackend,
} from '../src/auth/secureStoreAuthStorage'

class MemorySecureStore implements SecureStoreBackend {
  readonly values = new Map<string, string>()
  failGet = false
  failSet: ((key: string) => boolean) | null = null
  failDelete: ((key: string) => boolean) | null = null

  async getItemAsync(key: string): Promise<string | null> {
    if (this.failGet) throw new Error('keychain unavailable: provider-secret')
    return this.values.get(key) ?? null
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    if (this.failSet?.(key)) throw new Error('interrupted write: provider-secret')
    this.values.set(key, value)
  }

  async deleteItemAsync(key: string): Promise<void> {
    if (this.failDelete?.(key)) throw { token: 'delete-backend-secret' }
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

it('commits a replacement successfully and journals failed old-generation cleanup for retry', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: sequentialGenerations('old', 'current'),
  })
  await storage.setItem('session', 'known-good')
  backend.failDelete = (key) => key === 'session.__old.0'

  await expect(storage.setItem('session', 'new-session')).resolves.toBeUndefined()

  expect(JSON.parse(backend.values.get('session.__manifest') ?? '{}')).toEqual({
    version: 1,
    generation: 'current',
    chunks: 1,
  })
  const journal = backend.values.get('session.__cleanup') ?? ''
  expect(journal).toContain('old')
  expect(journal).not.toContain('known-good')
  expect(journal).not.toContain('new-session')

  backend.failDelete = null
  const restartedStorage = createSecureStoreAuthStorage({
    backend,
    createGeneration: () => 'after-restart',
  })
  await expect(restartedStorage.getItem('session')).resolves.toBe('new-session')
  expect(backend.values.has('session.__old.0')).toBe(false)
  expect(backend.values.has('session.__cleanup')).toBe(false)
})

it('does not touch the current manifest or write chunks when cleanup intent cannot be journaled', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: sequentialGenerations('old', 'replacement'),
  })
  await storage.setItem('session', 'known-good')
  backend.failSet = (key) => key === 'session.__cleanup'

  await expect(storage.setItem('session', 'replacement')).rejects.toBeInstanceOf(
    SecureAuthStorageError,
  )

  backend.failSet = null
  await expect(storage.getItem('session')).resolves.toBe('known-good')
  expect(backend.values.has('session.__replacement.0')).toBe(false)
})

it('journals an interrupted new generation until failed cleanup can be retried', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: sequentialGenerations('old', 'interrupted'),
  })
  await storage.setItem('session', 'known-good')
  backend.failSet = (key) => key === 'session.__manifest'
  backend.failDelete = (key) => key === 'session.__interrupted.0'

  await expect(storage.setItem('session', 'incomplete')).rejects.toBeInstanceOf(
    SecureAuthStorageError,
  )

  expect(JSON.parse(backend.values.get('session.__manifest') ?? '{}').generation).toBe('old')
  expect(backend.values.get('session.__cleanup')).toContain('interrupted')
  backend.failSet = null
  backend.failDelete = null
  await expect(storage.getItem('session')).resolves.toBe('known-good')
  expect(backend.values.has('session.__interrupted.0')).toBe(false)
  expect(backend.values.has('session.__cleanup')).toBe(false)
})

it('makes remove unreadable after a durable tombstone and retries chunk deletion later', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: () => 'remove-pending',
  })
  await storage.setItem('session', 'sensitive-session')
  backend.failDelete = (key) => key === 'session.__remove-pending.0'

  await expect(storage.removeItem('session')).resolves.toBeUndefined()

  expect(backend.values.has('session.__manifest')).toBe(false)
  expect(backend.values.get('session.__cleanup')).toContain('remove-pending')
  await expect(storage.getItem('session')).rejects.toBeInstanceOf(SecureAuthStorageError)

  backend.failDelete = null
  await expect(storage.getItem('session')).resolves.toBeNull()
  expect(backend.values.has('session.__remove-pending.0')).toBe(false)
  expect(backend.values.has('session.__cleanup')).toBe(false)
})

it('keeps retry metadata when deleting a completed cleanup journal fails', async () => {
  const backend = new MemorySecureStore()
  const storage = createSecureStoreAuthStorage({
    backend,
    createGeneration: () => 'journal-delete',
  })
  await storage.setItem('session', 'sensitive-session')
  backend.failDelete = (key) => key === 'session.__cleanup'

  await expect(storage.removeItem('session')).resolves.toBeUndefined()

  expect(backend.values.has('session.__manifest')).toBe(false)
  expect(backend.values.has('session.__journal-delete.0')).toBe(false)
  expect(backend.values.has('session.__cleanup')).toBe(true)
  backend.failDelete = null
  await expect(storage.getItem('session')).resolves.toBeNull()
  expect(backend.values.has('session.__cleanup')).toBe(false)
})

it('exports only stable content-free errors for backend and generation failures', async () => {
  const backend = new MemorySecureStore()
  backend.failGet = true
  const backendFailure = await createSecureStoreAuthStorage({ backend })
    .getItem('token-bearing-session')
    .catch((error: unknown) => error)
  expect(backendFailure).toBeInstanceOf(SecureAuthStorageError)
  expect(backendFailure).not.toHaveProperty('cause')
  expect(String(backendFailure)).not.toContain('provider-secret')
  expect(JSON.stringify(backendFailure)).not.toContain('provider-secret')

  backend.failGet = false
  const generationFailure = await createSecureStoreAuthStorage({
    backend,
    createGeneration: () => {
      throw { token: 'generation-secret' }
    },
  })
    .setItem('session', 'value')
    .catch((error: unknown) => error)
  expect(generationFailure).toBeInstanceOf(SecureAuthStorageError)
  expect(generationFailure).not.toHaveProperty('cause')
  expect(String(generationFailure)).not.toContain('generation-secret')
  expect(JSON.stringify(generationFailure)).not.toContain('generation-secret')
})
