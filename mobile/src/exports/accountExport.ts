import * as Crypto from 'expo-crypto'
import * as FileSystem from 'expo-file-system/legacy'

import type { PageRequest } from '../data/pagination'
import { canonicalStringify } from '../data/outbox'
import { utf8ByteLength } from '../data/quarantine'
import type { EntityName } from '../domain/sync'
import { tempArtifactRegistry } from '../files/tempArtifactRegistry'
import { exportRecordsToCsv } from './csvExport'
import {
  ACCOUNT_EXPORT_ENTITIES,
  type ExportManifestV1,
  type ExportRecord,
} from './exportSchemas'

const DEFAULT_MAX_EXPORT_BYTES = 50 * 1024 * 1024
const EXPORT_PAGE_SIZE = 50
const REDACTED_KEY = /(access.?token|refresh.?token|password|secret|receiptPath|receipt_path)/i

type ExportRepository = {
  listPage(entity: EntityName, request: PageRequest): Promise<{
    items: Record<string, unknown>[]
    next: PageRequest['after']
  }>
}

type ExportFileSystem = Pick<typeof FileSystem,
  'cacheDirectory' | 'makeDirectoryAsync' | 'writeAsStringAsync' | 'deleteAsync'>

export class AccountExportError extends Error {
  constructor(readonly code: 'AAL2_REQUIRED' | 'CACHE_UNAVAILABLE' | 'EXPORT_TOO_LARGE' | 'OWNER_CHANGED' | 'EXPORT_FAILED') {
    super(code === 'OWNER_CHANGED'
      ? 'The signed-in owner changed while the export was being prepared.'
      : code === 'EXPORT_TOO_LARGE'
        ? 'The account export exceeded the 50 MiB safety limit.'
        : 'The account export could not be prepared securely.')
    this.name = 'AccountExportError'
  }
}

const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitize)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !REDACTED_KEY.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sanitize(nested)]))
}

const requireOwner = (ownerId: string, currentOwnerId: () => string | null): void => {
  if (currentOwnerId() !== ownerId) throw new AccountExportError('OWNER_CHANGED')
}

export type AccountExportArtifact = Readonly<{
  directoryUri: string
  jsonUri: string
  csvUri: string
  manifestUri: string
  manifest: ExportManifestV1
  cleanup(): Promise<void>
}>

export const createAccountExport = async (options: Readonly<{
  ownerId: string
  currentOwnerId(): string | null
  requireRecentAal2(): void
  repository: ExportRepository
  entities?: readonly EntityName[]
  createdAt?: string
  createId?: () => string
  digest?: (content: string) => Promise<string>
  fileSystem?: ExportFileSystem
  maxBytes?: number
}>): Promise<AccountExportArtifact> => {
  try {
    options.requireRecentAal2()
  } catch (cause) {
    if (cause instanceof AccountExportError) throw cause
    throw new AccountExportError('AAL2_REQUIRED')
  }
  const fileSystem = options.fileSystem ?? FileSystem
  if (!fileSystem.cacheDirectory) throw new AccountExportError('CACHE_UNAVAILABLE')
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_EXPORT_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_EXPORT_BYTES) {
    throw new AccountExportError('EXPORT_TOO_LARGE')
  }
  const createdAt = options.createdAt ?? new Date().toISOString()
  const directoryUri = `${fileSystem.cacheDirectory}fieldcraft-export/${(options.createId ?? Crypto.randomUUID)()}`
  const jsonUri = `${directoryUri}/fieldcraft-account.json`
  const csvUri = `${directoryUri}/fieldcraft-account.csv`
  const manifestUri = `${directoryUri}/manifest.json`
  const cleanup = async () => fileSystem.deleteAsync(directoryUri, { idempotent: true })
  const digest = options.digest ?? ((content: string) => Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    content,
  ))

  try {
    requireOwner(options.ownerId, options.currentOwnerId)
    await fileSystem.makeDirectoryAsync(directoryUri, { intermediates: true })
    const records: ExportRecord[] = []
    for (const entity of options.entities ?? ACCOUNT_EXPORT_ENTITIES) {
      let after: PageRequest['after'] = null
      do {
        requireOwner(options.ownerId, options.currentOwnerId)
        const page: { items: Record<string, unknown>[]; next: PageRequest['after'] } =
          await options.repository.listPage(entity, {
          limit: EXPORT_PAGE_SIZE,
          after,
          })
        requireOwner(options.ownerId, options.currentOwnerId)
        for (const item of page.items) {
          const sanitized = sanitize(item) as Record<string, unknown>
          if (sanitized.ownerId !== options.ownerId) throw new AccountExportError('OWNER_CHANGED')
          records.push({ entity, data: sanitized })
        }
        after = page.next
      } while (after !== null)
    }
    const json = `${canonicalStringify({
      schemaVersion: 1,
      ownerId: options.ownerId,
      createdAt,
      records,
    })}\n`
    const csv = exportRecordsToCsv(records)
    const jsonBytes = utf8ByteLength(json)
    const csvBytes = utf8ByteLength(csv)
    if (jsonBytes + csvBytes > maxBytes) throw new AccountExportError('EXPORT_TOO_LARGE')
    const files = await Promise.all([
      digest(json).then((sha256) => ({ name: 'fieldcraft-account.json', rows: records.length, sha256, bytes: jsonBytes })),
      digest(csv).then((sha256) => ({ name: 'fieldcraft-account.csv', rows: records.length, sha256, bytes: csvBytes })),
    ])
    const manifest: ExportManifestV1 = {
      schemaVersion: 1,
      ownerId: options.ownerId,
      createdAt,
      files,
    }
    const manifestText = `${canonicalStringify(manifest)}\n`
    if (jsonBytes + csvBytes + utf8ByteLength(manifestText) > maxBytes) {
      throw new AccountExportError('EXPORT_TOO_LARGE')
    }
    requireOwner(options.ownerId, options.currentOwnerId)
    await fileSystem.writeAsStringAsync(jsonUri, json)
    await fileSystem.writeAsStringAsync(csvUri, csv)
    await fileSystem.writeAsStringAsync(manifestUri, manifestText)
    requireOwner(options.ownerId, options.currentOwnerId)
    tempArtifactRegistry.register(directoryUri, cleanup)
    return {
      directoryUri,
      jsonUri,
      csvUri,
      manifestUri,
      manifest,
      cleanup: () => tempArtifactRegistry.delete(directoryUri),
    }
  } catch (cause) {
    await cleanup().catch(() => {})
    if (cause instanceof AccountExportError) throw cause
    throw new AccountExportError('EXPORT_FAILED')
  }
}
