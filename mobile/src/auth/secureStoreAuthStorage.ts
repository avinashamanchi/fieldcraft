import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

const CHUNK_CODE_UNITS = 1_800
const MANIFEST_SUFFIX = '.__manifest'
const GENERATION_PATTERN = /^[A-Za-z0-9-]{1,128}$/
const STORAGE_ERROR_MESSAGE = 'Secure authentication storage is unavailable.'

export type SecureManifest = {
  version: 1
  generation: string
  chunks: number
}

export type SecureStoreBackend = {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

export class SecureAuthStorageError extends Error {
  constructor(cause?: unknown) {
    super(STORAGE_ERROR_MESSAGE, cause === undefined ? undefined : { cause })
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
const chunkKey = (key: string, generation: string, index: number) =>
  `${key}.__${generation}.${index}`

const parseManifest = (raw: string): SecureManifest => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new SecureAuthStorageError(error)
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).length !== 3 ||
    (value as Partial<SecureManifest>).version !== 1 ||
    typeof (value as Partial<SecureManifest>).generation !== 'string' ||
    !GENERATION_PATTERN.test((value as SecureManifest).generation) ||
    !Number.isSafeInteger((value as Partial<SecureManifest>).chunks) ||
    (value as SecureManifest).chunks < 1 ||
    (value as SecureManifest).chunks > 100_000
  ) {
    throw new SecureAuthStorageError()
  }
  return value as SecureManifest
}

const readManifest = async (
  backend: SecureStoreBackend,
  key: string,
): Promise<SecureManifest | null> => {
  const raw = await backend.getItemAsync(manifestKey(key))
  return raw === null ? null : parseManifest(raw)
}

const deleteGeneration = async (
  backend: SecureStoreBackend,
  key: string,
  manifest: SecureManifest,
): Promise<void> => {
  let firstError: unknown
  for (let index = 0; index < manifest.chunks; index += 1) {
    try {
      await backend.deleteItemAsync(chunkKey(key, manifest.generation, index))
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
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

export const createSecureStoreAuthStorage = (
  options: SecureStoreAuthStorageOptions = {},
): StorageAdapter => {
  const backend = options.backend ?? SecureStore
  const createGeneration = options.createGeneration ?? Crypto.randomUUID

  return {
    getItem: (key) =>
      serialize(backend, key, async () => {
        try {
          const manifest = await readManifest(backend, key)
          if (!manifest) return null
          const chunks: string[] = []
          for (let index = 0; index < manifest.chunks; index += 1) {
            const chunk = await backend.getItemAsync(chunkKey(key, manifest.generation, index))
            if (chunk === null) throw new SecureAuthStorageError()
            chunks.push(chunk)
          }
          return chunks.join('')
        } catch (error) {
          if (error instanceof SecureAuthStorageError) throw error
          throw new SecureAuthStorageError(error)
        }
      }),

    setItem: (key, value) =>
      serialize(backend, key, async () => {
        let prior: SecureManifest | null
        try {
          prior = await readManifest(backend, key)
        } catch (error) {
          throw error instanceof SecureAuthStorageError
            ? error
            : new SecureAuthStorageError(error)
        }
        const generation = createGeneration()
        if (
          !GENERATION_PATTERN.test(generation) ||
          prior?.generation === generation
        ) {
          throw new SecureAuthStorageError()
        }
        const chunks = Math.max(1, Math.ceil(value.length / CHUNK_CODE_UNITS))
        const next: SecureManifest = { version: 1, generation, chunks }
        try {
          for (let index = 0; index < chunks; index += 1) {
            await backend.setItemAsync(
              chunkKey(key, generation, index),
              value.slice(index * CHUNK_CODE_UNITS, (index + 1) * CHUNK_CODE_UNITS),
            )
          }
          await backend.setItemAsync(manifestKey(key), JSON.stringify(next))
        } catch (error) {
          try {
            await deleteGeneration(backend, key, next)
          } catch {
            // The original keychain failure remains the actionable error.
          }
          throw error instanceof SecureAuthStorageError
            ? error
            : new SecureAuthStorageError(error)
        }

        if (prior && prior.generation !== generation) {
          try {
            await deleteGeneration(backend, key, prior)
          } catch (error) {
            throw new SecureAuthStorageError(error)
          }
        }
      }),

    removeItem: (key) =>
      serialize(backend, key, async () => {
        try {
          const prior = await readManifest(backend, key)
          if (!prior) return
          await backend.deleteItemAsync(manifestKey(key))
          await deleteGeneration(backend, key, prior)
        } catch (error) {
          if (error instanceof SecureAuthStorageError) throw error
          throw new SecureAuthStorageError(error)
        }
      }),
  }
}

export const secureStoreAuthStorage = createSecureStoreAuthStorage()
