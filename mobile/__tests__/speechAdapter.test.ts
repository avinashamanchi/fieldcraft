import { createSpeechPort, SpeechPortError } from '../src/native/speech'

it('reports a truthful manual-only fallback when the native module is absent', async () => {
  const port = createSpeechPort(null)
  await expect(port.availability()).resolves.toBe('manual-only')
  await expect(port.start({ locale: 'en-US', maxDurationMs: 120_000 })).rejects.toMatchObject({ code: 'ON_DEVICE_UNAVAILABLE' })
})

it('requires the exact two-minute bound and suppresses duplicate starts', async () => {
  const native = {
    availability: jest.fn(async () => 'available' as const),
    start: jest.fn(async () => {}), stop: jest.fn(async () => ({ transcript: 'Final text' })), cancel: jest.fn(async () => {}),
  }
  const port = createSpeechPort(native)
  await expect(port.start({ locale: 'en-US', maxDurationMs: 119_999 as never })).rejects.toBeInstanceOf(SpeechPortError)
  await port.start({ locale: 'en-US', maxDurationMs: 120_000 })
  await expect(port.start({ locale: 'en-US', maxDurationMs: 120_000 })).rejects.toMatchObject({ code: 'ALREADY_RECORDING' })
  await expect(port.stop()).resolves.toEqual({ transcript: 'Final text' })
  expect(native.start).toHaveBeenCalledWith({ locale: 'en-US', maxDurationMs: 120_000 })
})

it('rejects empty or over-bound final text and maps permission denial', async () => {
  const native = {
    availability: jest.fn(async () => 'permission-denied' as const), start: jest.fn(async () => {}),
    stop: jest.fn(async () => ({ transcript: '' })), cancel: jest.fn(async () => {}),
  }
  const port = createSpeechPort(native)
  await expect(port.availability()).resolves.toBe('permission-denied')
  await port.start({ locale: 'en-US', maxDurationMs: 120_000 })
  await expect(port.stop()).rejects.toMatchObject({ code: 'NO_SPEECH' })

  native.stop.mockResolvedValueOnce({ transcript: '🧰'.repeat(20_001) })
  await port.start({ locale: 'en-US', maxDurationMs: 120_000 })
  await expect(port.stop()).rejects.toMatchObject({ code: 'TEXT_TOO_LARGE' })
})
