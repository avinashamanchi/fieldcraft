import { importBusinessLogo, logoStoragePath } from '../src/files/logoImport'

const pngPrefix = 'iVBORw0KGgo'

it('rejects active/non-raster inputs and enforces the 2 MiB source bound', async () => {
  const fs = {
    cacheDirectory: 'file:///cache/', makeDirectoryAsync: jest.fn(async () => {}), copyAsync: jest.fn(async () => {}), moveAsync: jest.fn(async () => {}),
    getInfoAsync: jest.fn(async () => ({ exists: true, size: 2 * 1024 * 1024 + 1 })),
    readAsStringAsync: jest.fn(async () => pngPrefix), deleteAsync: jest.fn(async () => {}),
  }
  const deps = { fileSystem: fs, manipulate: jest.fn(), getDimensions: async () => ({ width: 100, height: 100 }), createId: () => 'logo' }
  await expect(importBusinessLogo({ uri: 'data:image/png;base64,abc', mimeType: 'image/png' }, 'owner-a', deps)).rejects.toMatchObject({ code: 'UNSAFE_URI' })
  await expect(importBusinessLogo({ uri: 'file:///logo.svg', mimeType: 'image/svg+xml' }, 'owner-a', deps)).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' })
  await expect(importBusinessLogo({ uri: 'file:///logo.png', mimeType: 'image/png' }, 'owner-a', deps)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
})

it('decodes, scales to 512 pixels, rasterizes to JPEG, and uses an owner path', async () => {
  const fs = {
    cacheDirectory: 'file:///cache/', makeDirectoryAsync: jest.fn(async () => {}), copyAsync: jest.fn(async () => {}), moveAsync: jest.fn(async () => {}),
    getInfoAsync: jest.fn(async () => ({ exists: true, size: 1000 })),
    readAsStringAsync: jest.fn(async () => pngPrefix), deleteAsync: jest.fn(async () => {}),
  }
  const manipulate = jest.fn(async () => ({ uri: 'file:///cache/fieldcraft-logo-work/raster.jpg', width: 512, height: 256 }))
  const result = await importBusinessLogo({ uri: 'ph://logo', mimeType: 'image/png' }, 'owner-a', {
    fileSystem: fs, manipulate, getDimensions: async () => ({ width: 2048, height: 1024 }), createId: () => 'logo',
  })
  expect(manipulate).toHaveBeenCalledWith('file:///cache/fieldcraft-logo-work/logo.png', [{ resize: { width: 512 } }], expect.objectContaining({ format: 'jpeg' }))
  expect(result.storagePath).toBe('owner-a/logo.jpg')
  expect(logoStoragePath('owner-a')).toBe('owner-a/logo.jpg')
  await result.cleanup()
  expect(fs.deleteAsync).toHaveBeenCalled()
})
