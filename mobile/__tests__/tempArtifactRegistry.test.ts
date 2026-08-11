import { TempArtifactRegistry } from '../src/files/tempArtifactRegistry'

it('retains failed temporary cleanup work so deletion can be retried', async () => {
  const registry = new TempArtifactRegistry()
  const cleanup = jest.fn()
    .mockRejectedValueOnce(new Error('busy'))
    .mockResolvedValueOnce(undefined)
  const uri = 'file:///cache/fieldcraft-pdf/invoice.pdf'
  registry.register(uri, cleanup)

  await expect(registry.cleanupRegistered()).rejects.toThrow('could not be deleted')
  await expect(registry.cleanupRegistered()).resolves.toBeUndefined()
  expect(cleanup).toHaveBeenCalledTimes(2)
})

it('retains a failed individual cleanup until it succeeds', async () => {
  const registry = new TempArtifactRegistry()
  const cleanup = jest.fn()
    .mockRejectedValueOnce(new Error('busy'))
    .mockResolvedValueOnce(undefined)
  const uri = 'file:///cache/fieldcraft-imports/receipt.jpg'
  registry.register(uri, cleanup)

  await expect(registry.delete(uri)).rejects.toThrow('busy')
  await expect(registry.delete(uri)).resolves.toBeUndefined()
  expect(cleanup).toHaveBeenCalledTimes(2)
})

it('sweeps only FieldCraft-owned artifacts older than 24 hours', async () => {
  const registry = new TempArtifactRegistry()
  const now = Date.parse('2026-08-10T20:00:00.000Z')
  const fileSystem = {
    cacheDirectory: 'file:///cache/',
    readDirectoryAsync: jest.fn(async (uri: string) => uri.endsWith('fieldcraft-export') ? ['old-export', 'fresh-export'] : []),
    getInfoAsync: jest.fn(async (uri: string) => ({
      exists: true as const,
      uri,
      size: 1,
      isDirectory: false,
      modificationTime: uri.endsWith('old-export') ? (now - 25 * 60 * 60 * 1_000) / 1_000 : now / 1_000,
    })),
    deleteAsync: jest.fn(async () => {}),
  }
  await registry.sweepExpired(now, 24 * 60 * 60 * 1_000, fileSystem)
  expect(fileSystem.deleteAsync).toHaveBeenCalledTimes(1)
  expect(fileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/fieldcraft-export/old-export', { idempotent: true })
})
