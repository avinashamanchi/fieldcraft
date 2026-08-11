import { importReceiptImage } from '../src/files/imageImport'

const jpegPrefix = '/9j/'

it('handles cancellation and validates actual type, bytes, and decoded dimensions', async () => {
  const fileSystem = {
    cacheDirectory: 'file:///cache/', makeDirectoryAsync: jest.fn(async () => {}), copyAsync: jest.fn(async () => {}),
    getInfoAsync: jest.fn(async () => ({ exists: true, size: 13 * 1024 * 1024 })),
    readAsStringAsync: jest.fn(async () => jpegPrefix), deleteAsync: jest.fn(async () => {}),
  }
  await expect(importReceiptImage(null, { fileSystem, getDimensions: async () => ({ width: 100, height: 100 }), createId: () => 'id' })).resolves.toEqual({ cancelled: true })
  await expect(importReceiptImage({ uri: 'ph://asset', mimeType: 'image/jpeg' }, { fileSystem, getDimensions: async () => ({ width: 100, height: 100 }), createId: () => 'id' })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  expect(fileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/fieldcraft-imports/id.jpg', { idempotent: true })

  fileSystem.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 1000 })
  fileSystem.readAsStringAsync.mockResolvedValueOnce('AAAA')
  await expect(importReceiptImage({ uri: 'file:///fake.jpg', mimeType: 'image/jpeg' }, { fileSystem, getDimensions: async () => ({ width: 100, height: 100 }), createId: () => 'bad' })).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' })

  fileSystem.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 1000 })
  fileSystem.readAsStringAsync.mockResolvedValueOnce(jpegPrefix)
  await expect(importReceiptImage({ uri: 'file:///wide.jpg', mimeType: 'image/jpeg' }, { fileSystem, getDimensions: async () => ({ width: 4097, height: 100 }), createId: () => 'wide' })).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' })
})

it('copies non-local selections only into the owned receipt directory and returns cleanup', async () => {
  const fileSystem = {
    cacheDirectory: 'file:///cache/', makeDirectoryAsync: jest.fn(async () => {}), copyAsync: jest.fn(async () => {}),
    getInfoAsync: jest.fn(async () => ({ exists: true, size: 1000 })), readAsStringAsync: jest.fn(async () => jpegPrefix),
    deleteAsync: jest.fn(async () => {}),
  }
  const imported = await importReceiptImage({ uri: 'ph://asset', mimeType: 'image/jpeg' }, {
    fileSystem, getDimensions: async () => ({ width: 800, height: 1200 }), createId: () => 'receipt-id',
  })
  if (imported.cancelled) throw new Error('expected import')
  expect(fileSystem.copyAsync).toHaveBeenCalledWith({ from: 'ph://asset', to: 'file:///cache/fieldcraft-imports/receipt-id.jpg' })
  await imported.cleanup()
  expect(fileSystem.deleteAsync).toHaveBeenCalledWith(imported.uri, { idempotent: true })
})
