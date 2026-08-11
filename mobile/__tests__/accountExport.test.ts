import type { PageRequest } from '../src/data/pagination'
import { createAccountExport } from '../src/exports/accountExport'

const ownerId = '10000000-0000-4000-8000-000000000001'
const makeRows = () => Array.from({ length: 51 }, (_, index) => ({
  id: `record-${String(index).padStart(3, '0')}`,
  ownerId,
  version: 1,
  createdAt: '2026-08-10T20:00:00.000Z',
  updatedAt: `2026-08-10T20:00:${String(index % 60).padStart(2, '0')}.000Z`,
  syncState: 'current',
  name: index === 0 ? '=FORMULA' : `Client ${index}`,
  receiptPath: 'file:///private/receipt.jpg',
  accessToken: 'never-export-this',
}))

it('pages 50 rows at a time, redacts local secrets, hashes files, and cleans the artifact', async () => {
  const rows = makeRows()
  const pageSizes: number[] = []
  const repository = {
    listPage: jest.fn(async (_entity: string, request: PageRequest) => {
      pageSizes.push(request.limit)
      const start = request.after === null ? 0 : 50
      return { items: rows.slice(start, start + request.limit), next: start === 0 ? { updatedAt: rows[49].updatedAt, id: rows[49].id } : null }
    }),
  }
  const writes = new Map<string, string>()
  const fileSystem = {
    cacheDirectory: 'file:///cache/',
    makeDirectoryAsync: jest.fn(async () => {}),
    writeAsStringAsync: jest.fn(async (uri: string, content: string) => { writes.set(uri, content) }),
    deleteAsync: jest.fn(async () => {}),
  }
  const artifact = await createAccountExport({
    ownerId,
    currentOwnerId: () => ownerId,
    requireRecentAal2: jest.fn(),
    repository,
    entities: ['client'],
    createdAt: '2026-08-10T21:00:00.000Z',
    createId: () => 'export-id',
    digest: async (content) => `sha256-${content.length}`,
    fileSystem,
  })
  expect(pageSizes).toEqual([50, 50])
  expect(artifact.manifest.files).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'fieldcraft-account.json', rows: 51, sha256: expect.stringMatching(/^sha256-/) }),
    expect.objectContaining({ name: 'fieldcraft-account.csv', rows: 51, sha256: expect.stringMatching(/^sha256-/) }),
  ]))
  const combined = [...writes.values()].join('\n')
  expect(combined).not.toContain('never-export-this')
  expect(combined).not.toContain('file:///private/receipt.jpg')
  expect(combined).toContain("'=FORMULA")
  await artifact.cleanup()
  expect(fileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/fieldcraft-export/export-id', { idempotent: true })
})

it('fails closed on owner change and before crossing the 50 MiB cap', async () => {
  let currentOwner: string | null = ownerId
  const repository = {
    listPage: jest.fn(async () => {
      currentOwner = 'another-owner'
      return { items: makeRows().slice(0, 1), next: null }
    }),
  }
  const fileSystem = {
    cacheDirectory: 'file:///cache/', makeDirectoryAsync: jest.fn(async () => {}),
    writeAsStringAsync: jest.fn(async () => {}), deleteAsync: jest.fn(async () => {}),
  }
  await expect(createAccountExport({
    ownerId, currentOwnerId: () => currentOwner, requireRecentAal2: jest.fn(), repository,
    entities: ['client'], maxBytes: 64, createdAt: '2026-08-10T21:00:00.000Z',
    createId: () => 'export-id', digest: async () => 'sha256', fileSystem,
  })).rejects.toMatchObject({ code: 'OWNER_CHANGED' })
  expect(fileSystem.deleteAsync).toHaveBeenCalled()
})
