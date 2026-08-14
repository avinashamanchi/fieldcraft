import * as SecureStore from 'expo-secure-store'

const STORAGE_KEY = 'fieldcraft.owner-erasure.v1'
const MAX_PENDING_OWNERS = 64
const OWNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const LOCAL_DATA_MESSAGE = 'Local data could not be prepared securely.'

export type OwnerErasureBackend = Pick<
  typeof SecureStore,
  'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'
>

export type OwnerErasureRegistry = {
  list(): Promise<readonly string[]>
  mark(ownerId: string): Promise<void>
  clear(ownerId: string): Promise<void>
}

type OwnerErasureJournal = {
  version: 1
  ownerIds: string[]
}

const backendQueues = new WeakMap<object, Promise<void>>()

export class OwnerErasureRegistryError extends Error {
  constructor() {
    super(LOCAL_DATA_MESSAGE)
    this.name = 'OwnerErasureRegistryError'
  }
}

const requireOwnerId = (ownerId: string): string => {
  if (!OWNER_ID_PATTERN.test(ownerId)) throw new OwnerErasureRegistryError()
  return ownerId
}

const parseJournal = (raw: string): OwnerErasureJournal => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new OwnerErasureRegistryError()
  }
  const journal = value as Partial<OwnerErasureJournal>
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).length !== 2 ||
    journal.version !== 1 ||
    !Array.isArray(journal.ownerIds) ||
    journal.ownerIds.length > MAX_PENDING_OWNERS ||
    !journal.ownerIds.every((ownerId) => typeof ownerId === 'string' && OWNER_ID_PATTERN.test(ownerId)) ||
    new Set(journal.ownerIds).size !== journal.ownerIds.length
  ) {
    throw new OwnerErasureRegistryError()
  }
  return { version: 1, ownerIds: [...journal.ownerIds] }
}

const readJournal = async (backend: OwnerErasureBackend): Promise<OwnerErasureJournal> => {
  const raw = await backend.getItemAsync(STORAGE_KEY)
  return raw === null ? { version: 1, ownerIds: [] } : parseJournal(raw)
}

const serialize = <T>(backend: OwnerErasureBackend, work: () => Promise<T>): Promise<T> => {
  const previous = backendQueues.get(backend) ?? Promise.resolve()
  const current = previous.then(work, work)
  const settled = current.then(
    () => undefined,
    () => undefined,
  )
  backendQueues.set(backend, settled)
  void settled.finally(() => {
    if (backendQueues.get(backend) === settled) backendQueues.delete(backend)
  })
  return current
}

const stableFailure = (): OwnerErasureRegistryError => new OwnerErasureRegistryError()

export const createOwnerErasureRegistry = (
  backend: OwnerErasureBackend = SecureStore,
): OwnerErasureRegistry => ({
  list: () => serialize(backend, async () => {
    try {
      return Object.freeze([...(await readJournal(backend)).ownerIds])
    } catch {
      throw stableFailure()
    }
  }),

  mark: (ownerId) => serialize(backend, async () => {
    try {
      const canonicalOwnerId = requireOwnerId(ownerId)
      const journal = await readJournal(backend)
      if (journal.ownerIds.includes(canonicalOwnerId)) return
      if (journal.ownerIds.length >= MAX_PENDING_OWNERS) throw stableFailure()
      await backend.setItemAsync(STORAGE_KEY, JSON.stringify({
        version: 1,
        ownerIds: [...journal.ownerIds, canonicalOwnerId],
      } satisfies OwnerErasureJournal), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      })
    } catch {
      throw stableFailure()
    }
  }),

  clear: (ownerId) => serialize(backend, async () => {
    try {
      const canonicalOwnerId = requireOwnerId(ownerId)
      const journal = await readJournal(backend)
      const remaining = journal.ownerIds.filter((candidate) => candidate !== canonicalOwnerId)
      if (remaining.length === journal.ownerIds.length) return
      if (remaining.length === 0) {
        await backend.deleteItemAsync(STORAGE_KEY)
      } else {
        await backend.setItemAsync(STORAGE_KEY, JSON.stringify({
          version: 1,
          ownerIds: remaining,
        } satisfies OwnerErasureJournal), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        })
      }
    } catch {
      throw stableFailure()
    }
  }),
})

const ownerErasureRegistry = createOwnerErasureRegistry()

export const getOwnerErasureRegistry = (): OwnerErasureRegistry => ownerErasureRegistry
