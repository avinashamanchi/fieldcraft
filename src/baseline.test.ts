import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('FieldCraft web baseline', () => {
  it('never uses docs as the Vite build directory', () => {
    expect(readFileSync('vite.config.ts', 'utf8')).not.toMatch(/outDir:\s*['"]docs['"]/)
  })

  it('pins Node 22', () => {
    expect(readFileSync('.node-version', 'utf8').trim()).toBe('22')
  })

  it('requires the Node patch level required by React Router', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(packageJson.engines.node).toBe('>=22.22.0 <23')
  })

  it('uses the patched React Router package directly', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(packageJson.dependencies['react-router-dom']).toBeUndefined()
    expect(packageJson.dependencies['react-router']).toBe('8.3.0')
  })
})
