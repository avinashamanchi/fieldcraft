import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

const CHUNK_CODE_UNITS = 1_800
const MANIFEST_SUFFIX = '.__manifest'
const CLEANUP_SUFFIX = '.__cleanup'
const GENERATION_PATTERN = /^[A-Za-z0-9-]{1,128}$/
const MAX_CHUNKS = 100_000
const MAX_CLEANUP_GENERATIONS = 128
const STORAGE_ERROR_MESSAGE = 'Secure authentication storage is unavailable.'

export type SecureManifest = {
  version: 1
  generation: string
  chunks: number
}

type CleanupGeneration = Omit<SecureManifest, 'version'>
type CleanupJournal = { version: 1; generations: CleanupGeneration[] }

export type SecureStoreBackend = {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(
    key: string,
    value: string,
    options?: Parameters<typeof SecureStore.setItemAsync>[2],
  ): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

const DEVICE_ONLY_KEYCHAIN_OPTIONS = Object.freeze({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
})

const setDeviceOnlyItem = (
  backend: SecureStoreBackend,
  key: string,
  value: string,
): Promise<void> => backend.setItemAsync(key, value, DEVICE_ONLY_KEYCHAIN_OPTIONS)

export class SecureAuthStorageError extends Error {
  constructor() {
    super(STORAGE_ERROR_MESSAGE)
    this.name = 'SecureAuthStorageError'
  }
}

type SecureStoreAuthStorageOptions = {
  backend?: SecureStoreBackend
  createGeneration?: () => string
}

type StorageAdapter = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

const storageQueues = new WeakMap<object, Map<string, Promise<unknown>>>()

const manifestKey = (key: string) => `${key}${MANIFEST_SUFFIX}`
const cleanupKey = (key: string) => `${key}${CLEANUP_SUFFIX}`
const chunkKey = (key: string, generation: string, index: number) =>
  `${key}.__${generation}.${index}`

const isCleanupGeneration = (value: unknown): value is CleanupGeneration =>
  typeof value === 'object' &&
  value !== null &&
  Object.keys(value).length === 2 &&
  typeof (value as Partial<CleanupGeneration>).generation === 'string' &&
  GENERATION_PATTERN.test((value as CleanupGeneration).generation) &&
  Number.isSafeInteger((value as Partial<CleanupGeneration>).chunks) &&
  (value as CleanupGeneration).chunks >= 1 &&
  (value as CleanupGeneration).chunks <= MAX_CHUNKS

const parseManifest = (raw: string): SecureManifest => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new SecureAuthStorageError()
  }
  const manifest = value as Partial<SecureManifest>
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).length !== 3 ||
    manifest.version !== 1 ||
    typeof manifest.generation !== 'string' ||
    !GENERATION_PATTERN.test(manifest.generation) ||
    !Number.isSafeInteger(manifest.chunks) ||
    (manifest.chunks ?? 0) < 1 ||
    (manifest.chunks ?? 0) > MAX_CHUNKS
  ) {
    throw new SecureAuthStorageError()
  }
  return manifest as SecureManifest
}

const parseCleanupJournal = (raw: string): CleanupJournal => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new SecureAuthStorageError()
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).length !== 2 ||
    (value as Partial<CleanupJournal>).version !== 1 ||
    !Array.isArray((value as Partial<CleanupJournal>).generations) ||
    !(value as CleanupJournal).generations.every(isCleanupGeneration) ||
    (value as CleanupJournal).generations.length > MAX_CLEANUP_GENERATIONS
  ) {
    throw new SecureAuthStorageError()
  }
  return value as CleanupJournal
}

const readManifest = async (
  backend: SecureStoreBackend,
  key: string,
): Promise<SecureManifest | null> => {
  const raw = await backend.getItemAsync(manifestKey(key))
  return raw === null ? null : parseManifest(raw)
}

const readCleanupJournal = async (
  backend: SecureStoreBackend,
  key: string,
): Promise<CleanupJournal | null> => {
  const raw = await backend.getItemAsync(cleanupKey(key))
  return raw === null ? null : parseCleanupJournal(raw)
}

const dedupeGenerations = (entries: CleanupGeneration[]): CleanupGeneration[] => {
  const deduped = new Map<string, CleanupGeneration>()
  for (const entry of entries) deduped.set(entry.generation, entry)
  return [...deduped.values()]
}

const persistCleanupJournal = async (
  backend: SecureStoreBackend,
  key: string,
  generations: CleanupGeneration[],
): Promise<void> => {
  const deduped = dedupeGenerations(generations)
  if (deduped.length > MAX_CLEANUP_GENERATIONS) throw new SecureAuthStorageError()
  if (deduped.length === 0) {
    await backend.deleteItemAsync(cleanupKey(key))
    return
  }
  const journal: CleanupJournal = { version: 1, generations: deduped }
  await setDeviceOnlyItem(backend, cleanupKey(key), JSON.stringify(journal))
}

const retryCleanup = async (backend: SecureStoreBackend, key: string): Promise<void> => {
  const journal = await readCleanupJournal(backend, key)
  if (!journal) return
  const current = await readManifest(backend, key)
  const remaining: CleanupGeneration[] = []
  let cleanupFailed = false

  for (const generation of journal.generations) {
    if (current?.generation === generation.generation) continue
    let generationFailed = false
    for (let index = 0; index < generation.chunks; index += 1) {
      try {
        await backend.deleteItemAsync(chunkKey(key, generation.generation, index))
      } catch {
        generationFailed = true
        cleanupFailed = true
      }
    }
    if (generationFailed) remaining.push(generation)
  }

  await persistCleanupJournal(backend, key, remaining)
  if (cleanupFailed) throw new SecureAuthStorageError()
}

const serialize = <T>(backend: SecureStoreBackend, key: string, work: () => Promise<T>): Promise<T> => {
  let queues = storageQueues.get(backend)
  if (!queues) {
    queues = new Map()
    storageQueues.set(backend, queues)
  }
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.then(work, work)
  const settled = current.then(
    () => undefined,
    () => undefined,
  )
  queues.set(key, settled)
  void settled.finally(() => {
    if (queues?.get(key) === settled) queues.delete(key)
  })
  return current
}

const asStableStorageError = (): SecureAuthStorageError => new SecureAuthStorageError()

export const createSecureStoreAuthStorage = (
  options: SecureStoreAuthStorageOptions = {},
): StorageAdapter => {
  const backend = options.backend ?? SecureStore
  const createGeneration = options.createGeneration ?? Crypto.randomUUID

  return {
    getItem: (key) =>
      serialize(backend, key, async () => {
        try {
          await retryCleanup(backend, key)
          const manifest = await readManifest(backend, key)
          if (!manifest) return null
          const chunks: string[] = []
          for (let index = 0; index < manifest.chunks; index += 1) {
            const chunk = await backend.getItemAsync(chunkKey(key, manifest.generation, index))
            if (chunk === null) throw new SecureAuthStorageError()
            chunks.push(chunk)
          }
          return chunks.join('')
        } catch {
          throw asStableStorageError()
        }
      }),

    setItem: (key, value) =>
      serialize(backend, key, async () => {
        try {
          await retryCleanup(backend, key)
          const prior = await readManifest(backend, key)
          let generation: unknown
          try {
            generation = createGeneration()
          } catch {
            throw asStableStorageError()
          }
          if (
            typeof generation !== 'string' ||
            !GENERATION_PATTERN.test(generation) ||
            prior?.generation === generation
          ) {
            throw asStableStorageError()
          }
          const chunks = Math.max(1, Math.ceil(value.length / CHUNK_CODE_UNITS))
          const next: SecureManifest = { version: 1, generation, chunks }

          await persistCleanupJournal(
            backend,
            key,
            [
              ...(prior ? [{ generation: prior.generation, chunks: prior.chunks }] : []),
              { generation, chunks },
            ],
          )

          try {
            for (let index = 0; index < chunks; index += 1) {
              await setDeviceOnlyItem(
                backend,
                chunkKey(key, generation, index),
                value.slice(index * CHUNK_CODE_UNITS, (index + 1) * CHUNK_CODE_UNITS),
              )
            }
            await setDeviceOnlyItem(backend, manifestKey(key), JSON.stringify(next))
          } catch {
            try {
              await retryCleanup(backend, key)
            } catch {
              // The durable cleanup journal retains anything that could not be removed.
            }
            throw asStableStorageError()
          }

          try {
            await retryCleanup(backend, key)
          } catch {
            // The new manifest is committed; cleanup is durably journaled for a later operation.
          }
        } catch {
          throw asStableStorageError()
        }
      }),

    removeItem: (key) =>
      serialize(backend, key, async () => {
        try {
          try {
            await retryCleanup(backend, key)
          } catch {
            // A removal may still safely add the current generation to the durable journal.
          }
          const prior = await readManifest(backend, key)
          if (!prior) return
          const existing = await readCleanupJournal(backend, key)
          await persistCleanupJournal(backend, key, [
            ...(existing?.generations ?? []),
            { generation: prior.generation, chunks: prior.chunks },
          ])
          await backend.deleteItemAsync(manifestKey(key))
          try {
            await retryCleanup(backend, key)
          } catch {
            // The manifest is gone and the cleanup journal makes retry unambiguous.
          }
        } catch {
          throw asStableStorageError()
        }
      }),
  }
}

export const secureStoreAuthStorage = createSecureStoreAuthStorage()
