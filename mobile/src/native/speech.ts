import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core'

export type SpeechAvailability = 'available' | 'manual-only' | 'permission-denied'
export type SpeechTranscriptEvent = { transcript: string; isFinal: boolean }

export interface SpeechPort {
  availability(): Promise<SpeechAvailability>
  start(options: { locale: string; maxDurationMs: 120000 }): Promise<void>
  stop(): Promise<{ transcript: string }>
  cancel(): Promise<void>
  subscribe?(listener: (event: SpeechTranscriptEvent) => void): { remove(): void }
  subscribeError?(listener: (event: { code: SpeechErrorCode }) => void): { remove(): void }
}

export type NativeSpeechModule = {
  availability(): Promise<'available' | 'manual-only' | 'permission-denied'>
  start(options: { locale: string; maxDurationMs: number }): Promise<void>
  stop(): Promise<{ transcript: string }>
  cancel(): Promise<void>
  addListener?(event: 'onTranscript' | 'onSpeechError', listener: (event: never) => void): EventSubscription
}

export type SpeechErrorCode =
  | 'PERMISSION_DENIED'
  | 'ON_DEVICE_UNAVAILABLE'
  | 'ALREADY_RECORDING'
  | 'NOT_RECORDING'
  | 'TIMEOUT'
  | 'NO_SPEECH'
  | 'RECOGNITION_FAILED'
  | 'TEXT_TOO_LARGE'

export class SpeechPortError extends Error {
  constructor(readonly code: SpeechErrorCode) {
    super('On-device speech recognition could not complete.')
    this.name = 'SpeechPortError'
  }
}

const codeFrom = (cause: unknown, fallback: SpeechErrorCode): SpeechErrorCode => {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : ''
  return ['PERMISSION_DENIED', 'ON_DEVICE_UNAVAILABLE', 'ALREADY_RECORDING', 'NOT_RECORDING', 'TIMEOUT', 'NO_SPEECH', 'RECOGNITION_FAILED'].includes(code)
    ? code as SpeechErrorCode
    : fallback
}

export const createSpeechPort = (native: NativeSpeechModule | null): SpeechPort => {
  let recording = false
  return {
    async availability() {
      if (!native) return 'manual-only'
      try { return await native.availability() } catch { return 'manual-only' }
    },
    async start(options) {
      if (!native) throw new SpeechPortError('ON_DEVICE_UNAVAILABLE')
      if (options.maxDurationMs !== 120_000) throw new SpeechPortError('RECOGNITION_FAILED')
      if (recording) throw new SpeechPortError('ALREADY_RECORDING')
      try {
        await native.start(options)
        recording = true
      } catch (cause) {
        throw new SpeechPortError(codeFrom(cause, 'RECOGNITION_FAILED'))
      }
    },
    async stop() {
      if (!native || !recording) throw new SpeechPortError('NOT_RECORDING')
      try {
        const result = await native.stop()
        const transcript = result.transcript.trim()
        if (!transcript) throw new SpeechPortError('NO_SPEECH')
        if (Array.from(transcript).length > 20_000) throw new SpeechPortError('TEXT_TOO_LARGE')
        return { transcript }
      } catch (cause) {
        if (cause instanceof SpeechPortError) throw cause
        throw new SpeechPortError(codeFrom(cause, 'RECOGNITION_FAILED'))
      } finally {
        recording = false
      }
    },
    async cancel() {
      recording = false
      if (!native) return
      try { await native.cancel() } catch { /* cancellation is idempotent at the JS boundary */ }
    },
    subscribe(listener) {
      if (!native?.addListener) return { remove: () => {} }
      return native.addListener('onTranscript', ((event: SpeechTranscriptEvent) => {
        if (Array.from(event.transcript).length <= 20_000) listener(event)
      }) as never)
    },
    subscribeError(listener) {
      if (!native?.addListener) return { remove: () => {} }
      return native.addListener('onSpeechError', ((event: { code?: unknown }) => {
        const code = codeFrom(event, 'RECOGNITION_FAILED')
        recording = false
        listener({ code })
      }) as never)
    },
  }
}

const nativeSpeech = requireOptionalNativeModule<NativeSpeechModule>('FieldCraftSpeech')
export const speechPort = createSpeechPort(nativeSpeech)
