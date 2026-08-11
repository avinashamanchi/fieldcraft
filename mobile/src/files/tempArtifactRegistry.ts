import * as FileSystem from 'expo-file-system/legacy'

export const OWNED_TEMP_DIRECTORIES = ['fieldcraft-imports', 'fieldcraft-pdf', 'fieldcraft-logo-work'] as const

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
}

export const tempArtifactRegistry = new TempArtifactRegistry()
