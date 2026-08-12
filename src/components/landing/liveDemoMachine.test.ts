import { describe, expect, it } from 'vitest'
import {
  DEMO_STAGES,
  initialDemoStage,
  nextDemoStage,
} from './liveDemoMachine'

describe('FieldCraft landing demo state', () => {
  it('moves through the complete voice-to-invoice story in order', () => {
    expect(DEMO_STAGES).toEqual(['ready', 'listening', 'invoice', 'share'])
    expect(nextDemoStage('ready')).toBe('listening')
    expect(nextDemoStage('listening')).toBe('invoice')
    expect(nextDemoStage('invoice')).toBe('share')
    expect(nextDemoStage('share')).toBe('ready')
  })

  it('starts reduced-motion visitors on the completed invoice', () => {
    expect(initialDemoStage(true)).toBe('share')
    expect(initialDemoStage(false)).toBe('ready')
  })
})
