import * as FileSystem from 'expo-file-system/legacy'

export const OWNED_TEMP_DIRECTORIES = ['fieldcraft-imports', 'fieldcraft-pdf', 'fieldcraft-logo-work'] as const

type Cleanup = () => Promise<void>

class TempArtifactRegistry {
  private readonly cleanups = new Map<string, Cleanup>()

  register(uri: string, cleanup: Cleanup): void {
    if (!OWNED_TEMP_DIRECTORIES.some((directory) => uri.includes(`/${directory}/`))) {
      throw new Error('Temporary artifact is outside a FieldCraft-owned directory.')
    }
    this.cleanups.set(uri, cleanup)
  }

  async delete(uri: string): Promise<void> {
    const cleanup = this.cleanups.get(uri)
    this.cleanups.delete(uri)
    if (cleanup) await cleanup()
  }

  async cleanupRegistered(): Promise<void> {
    const entries = [...this.cleanups.entries()]
    this.cleanups.clear()
    await Promise.allSettled(entries.map(([, cleanup]) => cleanup()))
  }

  async cleanupOwnedDirectories(fileSystem: Pick<typeof FileSystem, 'cacheDirectory' | 'deleteAsync'> = FileSystem): Promise<void> {
    if (!fileSystem.cacheDirectory) return
    await Promise.allSettled(OWNED_TEMP_DIRECTORIES.map((directory) =>
      fileSystem.deleteAsync(`${fileSystem.cacheDirectory}${directory}`, { idempotent: true }),
    ))
  }
}

export const tempArtifactRegistry = new TempArtifactRegistry()
