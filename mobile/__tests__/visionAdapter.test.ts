import { createVisionPort, VisionPortError } from '../src/native/vision'

it('fails truthfully when Vision is absent and rejects non-local paths', async () => {
  await expect(createVisionPort(null).recognize('file:///receipt.jpg')).rejects.toMatchObject({ code: 'OCR_UNAVAILABLE' })
  const native = { recognize: jest.fn() }
  await expect(createVisionPort(native).recognize('https://example.test/receipt.jpg')).rejects.toMatchObject({ code: 'FILE_NOT_LOCAL' })
  expect(native.recognize).not.toHaveBeenCalled()
})

it('validates OCR shape and the 30000-code-point text bound', async () => {
  const native: { recognize: jest.Mock<Promise<unknown>, [string]> } = { recognize: jest.fn(async (_uri: string) => ({ text: '🧾'.repeat(30_001), confidence: 0.9, observations: [] })) }
  const port = createVisionPort(native)
  await expect(port.recognize('file:///receipt.jpg')).rejects.toBeInstanceOf(VisionPortError)
  native.recognize.mockResolvedValueOnce({ text: 'Supply Co\nTOTAL $12.34', confidence: 0.9, observations: [{ text: 'Supply Co', confidence: 0.9, x: 0.1, y: 0.9 }] })
  await expect(port.recognize('file:///receipt.jpg')).resolves.toMatchObject({ confidence: 0.9 })
})
