import * as Crypto from 'expo-crypto'
import { File } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { Image } from 'react-native'

import type { UserProfile } from '../domain/entities'
import type { MutationEnvelope } from '../domain/sync'
import { tempArtifactRegistry } from './tempArtifactRegistry'

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const MAX_LOGO_DIMENSION = 512

export type LogoImportErrorCode = 'CACHE_UNAVAILABLE' | 'DECODE_FAILED' | 'FILE_TOO_LARGE' | 'UNSAFE_URI' | 'UNSUPPORTED_TYPE'
export class LogoImportError extends Error {
  constructor(readonly code: LogoImportErrorCode) {
    super('The selected business logo could not be imported safely.')
    this.name = 'LogoImportError'
  }
}

type LogoSelection = { uri: string; mimeType?: string | null }
type FileSystemPort = {
  cacheDirectory: string | null
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>
  copyAsync(options: { from: string; to: string }): Promise<void>
  moveAsync?(options: { from: string; to: string }): Promise<void>
  getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number }>
  readAsStringAsync(uri: string, options: { encoding: FileSystem.EncodingType; position: number; length: number }): Promise<string>
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>
}
type Manipulate = (uri: string, actions: { resize: { width?: number; height?: number } }[], options: { compress: number; format: 'jpeg' }) => Promise<{ uri: string; width: number; height: number }>

const dimensions = (uri: string): Promise<{ width: number; height: number }> => new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject))
const signature = (prefix: string) => prefix.startsWith('/9j/') ? 'jpg' : prefix.startsWith('iVBORw0KGgo') ? 'png' : prefix.includes('ZnR5cGhlaWM') || prefix.includes('ZnR5cGhlaWY') ? 'heic' : null

export const logoStoragePath = (ownerId: string): string => {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(ownerId)) throw new LogoImportError('UNSAFE_URI')
  return `${ownerId}/logo.jpg`
}

export type ImportedBusinessLogo = {
  uri: string
  storagePath: string
  width: number
  height: number
  cleanup(): Promise<void>
}

export const importBusinessLogo = async (
  selection: LogoSelection,
  ownerId: string,
  dependencies: {
    createId?: () => string
    fileSystem?: FileSystemPort
    getDimensions?: (uri: string) => Promise<{ width: number; height: number }>
    manipulate?: Manipulate
  } = {},
): Promise<ImportedBusinessLogo> => {
  if (!selection.uri.startsWith('file://') && !selection.uri.startsWith('ph://')) throw new LogoImportError('UNSAFE_URI')
  const claimed = selection.mimeType?.toLocaleLowerCase()
  const extension = claimed === 'image/png' ? 'png' : claimed === 'image/jpeg' || claimed === 'image/jpg' ? 'jpg' : claimed === 'image/heic' || claimed === 'image/heif' ? 'heic' : null
  if (!extension) throw new LogoImportError('UNSUPPORTED_TYPE')
  const fileSystem = dependencies.fileSystem ?? FileSystem
  if (!fileSystem.cacheDirectory) throw new LogoImportError('CACHE_UNAVAILABLE')
  const directory = `${fileSystem.cacheDirectory}fieldcraft-logo-work`
  const id = (dependencies.createId ?? Crypto.randomUUID)()
  const sourceUri = `${directory}/${id}.${extension}`
  const outputUri = `${directory}/${id}.jpg`
  const removeAll = async () => {
    await Promise.allSettled([
      fileSystem.deleteAsync(sourceUri, { idempotent: true }),
      fileSystem.deleteAsync(outputUri, { idempotent: true }),
    ])
  }
  try {
    await fileSystem.makeDirectoryAsync(directory, { intermediates: true })
    await fileSystem.copyAsync({ from: selection.uri, to: sourceUri })
    const info = await fileSystem.getInfoAsync(sourceUri)
    if (!info.exists || !Number.isSafeInteger(info.size)) throw new LogoImportError('DECODE_FAILED')
    if (Number(info.size) > MAX_LOGO_BYTES) throw new LogoImportError('FILE_TOO_LARGE')
    const prefix = await fileSystem.readAsStringAsync(sourceUri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 24 })
    if (signature(prefix) !== extension) throw new LogoImportError('UNSUPPORTED_TYPE')
    const input = await (dependencies.getDimensions ?? dimensions)(sourceUri)
    if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) throw new LogoImportError('DECODE_FAILED')
    const action = input.width >= input.height ? { resize: { width: Math.min(input.width, MAX_LOGO_DIMENSION) } } : { resize: { height: Math.min(input.height, MAX_LOGO_DIMENSION) } }
    const result = await (dependencies.manipulate ?? ((uri, actions, options) => manipulateAsync(uri, actions, { ...options, format: SaveFormat.JPEG })))(sourceUri, [action], { compress: 0.9, format: 'jpeg' })
    if (result.width > MAX_LOGO_DIMENSION || result.height > MAX_LOGO_DIMENSION || result.width <= 0 || result.height <= 0) throw new LogoImportError('DECODE_FAILED')
    if (result.uri !== outputUri) {
      if (!fileSystem.moveAsync) throw new LogoImportError('DECODE_FAILED')
      await fileSystem.moveAsync({ from: result.uri, to: outputUri })
    }
    const outputInfo = await fileSystem.getInfoAsync(outputUri)
    if (!outputInfo.exists || !Number.isSafeInteger(outputInfo.size) || Number(outputInfo.size) > MAX_LOGO_BYTES) throw new LogoImportError('FILE_TOO_LARGE')
    tempArtifactRegistry.register(outputUri, removeAll)
    return { uri: outputUri, storagePath: logoStoragePath(ownerId), width: result.width, height: result.height, cleanup: () => tempArtifactRegistry.delete(outputUri) }
  } catch (cause) {
    await removeAll()
    if (cause instanceof LogoImportError) throw cause
    throw new LogoImportError('DECODE_FAILED')
  }
}

export const uploadBusinessLogo = async (
  logo: ImportedBusinessLogo,
  storage: { from(bucket: string): { upload(path: string, body: ArrayBuffer, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: unknown }> } },
): Promise<string> => {
  const bytes = await new File(logo.uri).arrayBuffer()
  const { error } = await storage.from('business-logos').upload(logo.storagePath, bytes, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error('Business logo upload failed.')
  return logo.storagePath
}

export const buildProfileLogoMutation = (profile: UserProfile, logoPath: string, mutationId: string, now: string): MutationEnvelope => ({
  id: mutationId, ownerId: profile.ownerId, entity: 'profile', entityId: profile.id,
  kind: 'update', baseVersion: profile.version,
  payload: { ...profile, logoPath, syncState: 'pending', updatedAt: now },
  createdAt: now, attempts: 0,
})
