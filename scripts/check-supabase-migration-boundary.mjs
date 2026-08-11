import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const setupResult = spawnSync('python3', ['scripts/setup-supabase.py'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    SUPABASE_ACCESS_TOKEN: '',
    GITHUB_TOKEN: '',
  },
})

assert.equal(setupResult.status, 2, 'legacy setup must fail closed before remote work')
assert.match(
  setupResult.stderr,
  /LEGACY_SETUP_DISABLED/,
  'legacy setup must explain that migration deployment is disabled',
)

const workflow = readFileSync('.github/workflows/setup-backend.yml', 'utf8')
assert.doesNotMatch(workflow, /scripts\/setup-supabase\.py/, 'CI must not execute the legacy script')
assert.doesNotMatch(workflow, /supabase_token|SUPABASE_ACCESS_TOKEN/, 'disabled CI must not request credentials')
assert.match(workflow, /exit 1/, 'disabled CI must fail closed')

const legacySchema = readFileSync('supabase/schema.sql', 'utf8')
const executableLines = legacySchema
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'))
assert.deepEqual(executableLines, [], 'legacy schema pointer must contain no executable SQL')

console.log('legacy setup exits before remote work')
console.log('CI contains no executable legacy setup or credentials')
console.log('schema.sql contains comments only')
