import { deleteLocalData } from '../src/privacy/deleteLocalData'

const dependencies = () => ({
  clearVisibleMemory: jest.fn(),
  clearRepository: jest.fn(async () => {}), clearOutbox: jest.fn(async () => {}), clearConflicts: jest.fn(async () => {}),
  clearAuth: jest.fn(async () => {}), clearConsent: jest.fn(async () => {}), clearArtifacts: jest.fn(async () => {}),
  setRetryMarker: jest.fn(async () => {}), clearRetryMarker: jest.fn(async () => {}),
})

it('clears visible memory first, attempts every subsystem, and removes the retry marker only on success', async () => {
  const deps = dependencies()
  const order: string[] = []
  deps.clearVisibleMemory.mockImplementation(() => order.push('memory'))
  deps.clearRepository.mockImplementation(async () => { order.push('repository') })
  await expect(deleteLocalData('owner-a', deps)).resolves.toEqual({ ok: true })
  expect(order[0]).toBe('memory')
  for (const operation of ['clearRepository', 'clearOutbox', 'clearConflicts', 'clearAuth', 'clearConsent', 'clearArtifacts'] as const) expect(deps[operation]).toHaveBeenCalledTimes(1)
  expect(deps.clearRetryMarker).toHaveBeenCalledWith('owner-a')
})

it('reports every failed subsystem, keeps a retry marker, and retries all work', async () => {
  const deps = dependencies()
  deps.clearOutbox.mockRejectedValueOnce(new Error('outbox'))
  deps.clearArtifacts.mockRejectedValueOnce(new Error('files'))
  await expect(deleteLocalData('owner-a', deps)).resolves.toEqual({ ok: false, failed: ['outbox', 'artifacts'] })
  expect(deps.setRetryMarker).toHaveBeenLastCalledWith('owner-a', ['outbox', 'artifacts'])
  await expect(deleteLocalData('owner-a', deps)).resolves.toEqual({ ok: true })
  expect(deps.clearRepository).toHaveBeenCalledTimes(2)
})
