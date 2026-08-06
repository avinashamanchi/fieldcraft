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
