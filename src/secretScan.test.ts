import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @ts-expect-error The production scanner is intentionally a directly executable Node ESM file.
import { scanSecretText } from '../scripts/scan-secrets.mjs'

describe('redacted secret scanner', () => {
  it.each([
    ['fixture.json', '{"GROQ_API_KEY":"gsk_123456789012345678901234"}', 'provider-api-key'],
    ['fixture.yaml', 'SUPABASE_SERVICE_ROLE_KEY: service_role_12345678901234567890', 'private-env-assignment'],
    ['fixture.sh', 'export AI_RATE_LIMIT_HMAC_SECRET=abcdef0123456789abcdef0123456789', 'private-env-assignment'],
    ['fixture.txt', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456', 'bearer-token'],
  ])('reports only path, rule, and count for %s', (path, value, expectedRule) => {
    const findings = scanSecretText(path, value)
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ path, ruleId: expectedRule, count: 1 })]))
    expect(JSON.stringify(findings)).not.toContain(value.split(/[:=]/).at(-1)?.trim())
  })

  it('allows documented public placeholders and environment lookups', () => {
    const fixture = 'GROQ_API_KEY=${GROQ_API_KEY}\nSUPABASE_SERVICE_ROLE_KEY=replace-me\nconst key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'
    expect(scanSecretText('safe.env.example', fixture)).toEqual([])
  })
})

describe('release workflow contracts', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
  const requiredCommands = ['npm ci', 'npm test', 'npm run typecheck', 'npm run lint', 'npm run build', 'npm run scan:secrets']

  it('uses Node 22 and runs web, mobile, backend, Doctor, export, and scanner gates in CI', () => {
    const workflow = read('.github/workflows/ci.yml')
    expect(workflow).toContain('node-version: 22.22.0')
    for (const command of requiredCommands) expect(workflow).toContain(command)
    for (const command of ['npm run expo:doctor', 'npm run export:ios', 'npm run test:supabase-pglite', 'deno test']) expect(workflow).toContain(command)
    expect(workflow).toContain('check-mobile-audit.mjs')
  })

  it('makes Pages deployment wait for the same three gate classes', () => {
    const workflow = read('.github/workflows/deploy.yml')
    expect(workflow).toContain('needs: [web-gates, mobile-gates, backend-gates]')
    for (const command of requiredCommands) expect(workflow).toContain(command)
    expect(workflow).toContain('check-mobile-audit.mjs')
  })

  it('keeps release readiness manual-only and unable to deploy or submit', () => {
    const workflow = read('.github/workflows/release-readiness.yml')
    expect(workflow).toMatch(/on:\s*\n\s*workflow_dispatch:/)
    expect(workflow).not.toMatch(/\bpush:|pull_request:|deploy-pages|\beas(?:-cli)?\b[^\n]*submit|\bsupabase\b[^\n]*deploy/i)
    for (const command of [...requiredCommands, 'npm run expo:doctor', 'npm run export:ios', 'deno check']) expect(workflow).toContain(command)
    expect(workflow).toContain('check-mobile-audit.mjs')
    expect(workflow).toContain('deployed=false')
    expect(workflow).toContain('submitted=false')
  })

  it('allows only the two reviewed Expo parser advisories and fails closed on new severe findings', () => {
    const auditGate = read('scripts/check-mobile-audit.mjs')
    expect(auditGate).toContain('1138808')
    expect(auditGate).toContain('1138809')
    expect(auditGate).toContain('--audit-level=high')
    expect(auditGate).toContain('unproven-chain')
    expect(auditGate).toContain('report.error')
  })

  it('keeps the app icon exact, opaque RGB, and configured without project credentials', () => {
    const icon = readFileSync(resolve(process.cwd(), 'mobile/assets/icon.png'))
    expect(icon.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(icon.readUInt32BE(16)).toBe(1024)
    expect(icon.readUInt32BE(20)).toBe(1024)
    expect(icon[25]).toBe(2)
    const config = read('mobile/app.config.ts')
    expect(config).toContain("icon: './assets/icon.png'")
    expect(config).not.toMatch(/projectId|ascAppId|appleId|appleTeamId/)
  })

  it('passes the scanner against the tracked tree and existing bundles', () => {
    expect(() => execFileSync(process.execPath, ['scripts/scan-secrets.mjs'], { cwd: process.cwd(), stdio: 'pipe' })).not.toThrow()
  })
})
