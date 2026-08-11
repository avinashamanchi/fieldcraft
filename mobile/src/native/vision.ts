import { requireOptionalNativeModule } from 'expo-modules-core'
import { z } from 'zod'

export type ReceiptOcrResult = {
  text: string
  confidence: number
  observations: { text: string; confidence: number; x: number; y: number }[]
}

export type VisionErrorCode = 'FILE_NOT_LOCAL' | 'FILE_TOO_LARGE' | 'IMAGE_UNREADABLE' | 'OCR_UNAVAILABLE' | 'OCR_FAILED' | 'TEXT_TOO_LARGE'
export class VisionPortError extends Error {
  constructor(readonly code: VisionErrorCode) {
    super('On-device receipt recognition could not complete.')
    this.name = 'VisionPortError'
  }
}

type NativeVisionModule = { recognize(uri: string): Promise<unknown> }
export interface VisionPort { recognize(uri: string): Promise<ReceiptOcrResult> }

const boundedText = (maximum: number) => z.string().refine((value) => Array.from(value).length <= maximum)
const ResultSchema = z.object({
  text: boundedText(30_000),
  confidence: z.number().finite().min(0).max(1),
  observations: z.array(z.object({
    text: boundedText(1000), confidence: z.number().finite().min(0).max(1),
    x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
  }).strict()).max(5000),
}).strict()

const nativeCode = (cause: unknown): VisionErrorCode => {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code: unknown }).code) : ''
  return ['FILE_NOT_LOCAL', 'FILE_TOO_LARGE', 'IMAGE_UNREADABLE', 'OCR_UNAVAILABLE', 'OCR_FAILED', 'TEXT_TOO_LARGE'].includes(code)
    ? code as VisionErrorCode
    : 'OCR_FAILED'
}

export const createVisionPort = (native: NativeVisionModule | null): VisionPort => ({
  async recognize(uri) {
    if (!uri.startsWith('file://')) throw new VisionPortError('FILE_NOT_LOCAL')
    if (!native) throw new VisionPortError('OCR_UNAVAILABLE')
    try {
      const raw = await native.recognize(uri)
      const parsed = ResultSchema.safeParse(raw)
      if (!parsed.success) {
        const tooLarge = typeof raw === 'object' && raw !== null && 'text' in raw && typeof raw.text === 'string' && Array.from(raw.text).length > 30_000
        throw new VisionPortError(tooLarge ? 'TEXT_TOO_LARGE' : 'OCR_FAILED')
      }
      return parsed.data
    } catch (cause) {
      if (cause instanceof VisionPortError) throw cause
      throw new VisionPortError(nativeCode(cause))
    }
  },
})

export const visionPort = createVisionPort(requireOptionalNativeModule<NativeVisionModule>('FieldCraftVision'))
