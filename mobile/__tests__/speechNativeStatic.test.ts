import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const swiftPath = resolve(__dirname, '../modules/fieldcraft-speech/ios/FieldCraftSpeechModule.swift')
const configPath = resolve(__dirname, '../app.config.ts')

it('uses on-device recognition with one in-memory audio tap and stable lifecycle codes', () => {
  const swift = readFileSync(swiftPath, 'utf8')
  expect(swift).toContain('requiresOnDeviceRecognition = true')
  expect(swift).toContain('installTap')
  expect(swift).toContain('removeTap')
  for (const code of ['PERMISSION_DENIED', 'ON_DEVICE_UNAVAILABLE', 'ALREADY_RECORDING', 'NOT_RECORDING', 'TIMEOUT', 'NO_SPEECH', 'RECOGNITION_FAILED']) {
    expect(swift).toContain(code)
  }
  expect(swift).not.toMatch(/write\(|FileManager|temporaryDirectory|\.caf|\.m4a|\.wav/)
})

it('declares exact least-privilege iOS purpose strings and no background audio mode', () => {
  const config = readFileSync(configPath, 'utf8')
  expect(config).toContain('FieldCraft uses the microphone only while you record a job description for an editable invoice draft.')
  expect(config).toContain('FieldCraft converts your spoken job description into editable text on this device.')
  expect(config).not.toContain('UIBackgroundModes')
})
