import * as FileSystem from 'expo-file-system/legacy'

export const OWNED_TEMP_DIRECTORIES = [
  'fieldcraft-imports',
  'fieldcraft-pdf',
  'fieldcraft-logo-work',
  'fieldcraft-export',
] as const

type Cleanup = () => Promise<void>

export class TempArtifactRegistry {
  private readonly cleanups = new Map<string, Cleanup>()

  register(uri: string, cleanup: Cleanup): void {
    if (!OWNED_TEMP_DIRECTORIES.some((directory) => uri.includes(`/${directory}/`))) {
      throw new Error('Temporary artifact is outside a FieldCraft-owned directory.')
    }
    this.cleanups.set(uri, cleanup)
  }

  async delete(uri: string): Promise<void> {
    const cleanup = this.cleanups.get(uri)
    if (!cleanup) return
    await cleanup()
    if (this.cleanups.get(uri) === cleanup) this.cleanups.delete(uri)
  }

  async cleanupRegistered(): Promise<void> {
    const entries = [...this.cleanups.entries()]
    const results = await Promise.allSettled(entries.map(([, cleanup]) => cleanup()))
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const [uri, cleanup] = entries[index]
        if (this.cleanups.get(uri) === cleanup) this.cleanups.delete(uri)
      }
    })
    if (results.some((result) => result.status === 'rejected')) throw new Error('Some temporary artifacts could not be deleted.')
  }

  async cleanupOwnedDirectories(fileSystem: Pick<typeof FileSystem, 'cacheDirectory' | 'deleteAsync'> = FileSystem): Promise<void> {
    if (!fileSystem.cacheDirectory) return
    const results = await Promise.allSettled(OWNED_TEMP_DIRECTORIES.map((directory) =>
      fileSystem.deleteAsync(`${fileSystem.cacheDirectory}${directory}`, { idempotent: true }),
    ))
    if (results.some((result) => result.status === 'rejected')) throw new Error('Some FieldCraft temporary directories could not be deleted.')
  }

  async sweepExpired(
    now = Date.now(),
    maximumAgeMs = 24 * 60 * 60 * 1_000,
    fileSystem: Pick<typeof FileSystem,
      'cacheDirectory' | 'readDirectoryAsync' | 'getInfoAsync' | 'deleteAsync'> = FileSystem,
  ): Promise<void> {
    if (!fileSystem.cacheDirectory) return
    if (!Number.isFinite(now) || !Number.isFinite(maximumAgeMs) || maximumAgeMs < 1) {
      throw new Error('Temporary artifact retention settings are invalid.')
    }
    const cutoffSeconds = (now - maximumAgeMs) / 1_000
    const failures: unknown[] = []
    for (const directory of OWNED_TEMP_DIRECTORIES) {
      const directoryUri = `${fileSystem.cacheDirectory}${directory}`
      let entries: string[]
      try { entries = await fileSystem.readDirectoryAsync(directoryUri) }
      catch { continue }
      for (const entry of entries) {
        if (!entry || entry.includes('/') || entry.includes('\\') || entry === '.' || entry === '..') {
          failures.push(new Error('Unsafe temporary artifact name'))
          continue
        }
        const uri = `${directoryUri}/${entry}`
        try {
          const info = await fileSystem.getInfoAsync(uri)
          if (info.exists && typeof info.modificationTime === 'number' && info.modificationTime <= cutoffSeconds) {
            await fileSystem.deleteAsync(uri, { idempotent: true })
            this.cleanups.delete(uri)
          }
        } catch (cause) { failures.push(cause) }
      }
    }
    if (failures.length > 0) throw new Error('Some expired FieldCraft temporary artifacts could not be deleted.')
  }
}

export const tempArtifactRegistry = new TempArtifactRegistry()
