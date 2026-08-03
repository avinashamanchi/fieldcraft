import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('FieldCraft web baseline', () => {
  it('never uses docs as the Vite build directory', () => {
    expect(readFileSync('vite.config.ts', 'utf8')).not.toMatch(/outDir:\s*['"]docs['"]/)
  })

  it('pins Node 22', () => {
    expect(readFileSync('.node-version', 'utf8').trim()).toBe('22')
  })
})
