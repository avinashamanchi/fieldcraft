import * as Crypto from 'expo-crypto'
import * as FileSystem from 'expo-file-system/legacy'
import { Image } from 'react-native'

import { tempArtifactRegistry } from './tempArtifactRegistry'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 4096

export type ImageImportErrorCode = 'CACHE_UNAVAILABLE' | 'FILE_TOO_LARGE' | 'IMAGE_TOO_LARGE' | 'IMAGE_UNREADABLE' | 'UNSUPPORTED_TYPE'
export class ImageImportError extends Error {
  constructor(readonly code: ImageImportErrorCode) {
    super('The selected receipt image could not be imported.')
    this.name = 'ImageImportError'
  }
}

export type ReceiptImageSelection = { uri: string; mimeType?: string | null }
type FileSystemPort = {
  cacheDirectory: string | null
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>
  copyAsync(options: { from: string; to: string }): Promise<void>
  getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number }>
  readAsStringAsync(uri: string, options: { encoding: FileSystem.EncodingType; position: number; length: number }): Promise<string>
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>
}

type ImportDependencies = {
  createId?: () => string
  fileSystem?: FileSystemPort
  getDimensions?: (uri: string) => Promise<{ width: number; height: number }>
}

const defaultDimensions = (uri: string): Promise<{ width: number; height: number }> => new Promise((resolve, reject) => {
  Image.getSize(uri, (width, height) => resolve({ width, height }), reject)
})

const detectedExtension = (prefix: string): 'jpg' | 'png' | 'heic' | null => {
  if (prefix.startsWith('/9j/')) return 'jpg'
  if (prefix.startsWith('iVBORw0KGgo')) return 'png'
  if (prefix.includes('ZnR5cGhlaWM') || prefix.includes('ZnR5cGhlaWY') || prefix.includes('ZnR5cG1pZjE')) return 'heic'
  return null
}

export type ImportedReceiptImage = {
  cancelled: false
  uri: string
  width: number
  height: number
  cleanup(): Promise<void>
}

export const importReceiptImage = async (
  selection: ReceiptImageSelection | null,
  dependencies: ImportDependencies = {},
): Promise<{ cancelled: true } | ImportedReceiptImage> => {
  if (!selection) return { cancelled: true }
  const fileSystem = dependencies.fileSystem ?? FileSystem
  if (!fileSystem.cacheDirectory) throw new ImageImportError('CACHE_UNAVAILABLE')
  const claimed = selection.mimeType?.toLocaleLowerCase()
  const extension = claimed === 'image/png' ? 'png' : claimed === 'image/heic' || claimed === 'image/heif' ? 'heic' : claimed === 'image/jpeg' || claimed === 'image/jpg' ? 'jpg' : null
  if (!extension) throw new ImageImportError('UNSUPPORTED_TYPE')
  const directory = `${fileSystem.cacheDirectory}fieldcraft-imports`
  const uri = `${directory}/${(dependencies.createId ?? Crypto.randomUUID)()}.${extension}`
  const remove = () => fileSystem.deleteAsync(uri, { idempotent: true })
  try {
    await fileSystem.makeDirectoryAsync(directory, { intermediates: true })
    await fileSystem.copyAsync({ from: selection.uri, to: uri })
    const info = await fileSystem.getInfoAsync(uri)
    if (!info.exists || !Number.isSafeInteger(info.size)) throw new ImageImportError('IMAGE_UNREADABLE')
    if (Number(info.size) > MAX_IMAGE_BYTES) throw new ImageImportError('FILE_TOO_LARGE')
    const prefix = await fileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 24 })
    if (detectedExtension(prefix) !== extension) throw new ImageImportError('UNSUPPORTED_TYPE')
    const dimensions = await (dependencies.getDimensions ?? defaultDimensions)(uri)
    if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) throw new ImageImportError('IMAGE_UNREADABLE')
    if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) throw new ImageImportError('IMAGE_TOO_LARGE')
    tempArtifactRegistry.register(uri, remove)
    return {
      cancelled: false, uri, ...dimensions,
      cleanup: () => tempArtifactRegistry.delete(uri),
    }
  } catch (cause) {
    await remove().catch(() => {})
    if (cause instanceof ImageImportError) throw cause
    throw new ImageImportError('IMAGE_UNREADABLE')
  }
}
