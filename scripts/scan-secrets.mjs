import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXACT_EXCLUSIONS = new Set([
  'src/secretScan.test.ts',
])

const TEXT_EXTENSIONS = new Set([
  '', '.cjs', '.css', '.env', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.plist', '.sh', '.sql', '.svg', '.ts', '.tsx', '.txt', '.yaml', '.yml',
])

const EXACT_PUBLIC_FIXTURES = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature',
]

export const SECRET_RULES = [
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: 'provider-api-key', pattern: /\b(?:gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g },
  { id: 'bearer-token', pattern: /\bBearer[ \t]+(?!\$\{|<|REDACTED\b)[A-Za-z0-9._~+\/-]{24,}={0,2}\b/g },
  { id: 'jwt-token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    id: 'private-env-assignment',
    pattern: /\b(?:GROQ_API_KEY|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|AI_RATE_LIMIT_HMAC_SECRET|REVENUECAT_WEBHOOK_SECRET|REVENUECAT_WEBHOOK_SIGNING_SECRET|EXPO_TOKEN|APPLE_APP_SPECIFIC_PASSWORD)\b[ \t]*[:=][ \t]*["']?(?!\$\{|process\.env|Deno\.env|<|REDACTED\b|replace-me\b)[A-Za-z0-9._~+\/-]{12,}/g,
  },
]

export const scanSecretText = (path, contents) => {
  const redactedFixtures = EXACT_PUBLIC_FIXTURES.reduce((value, fixture) => value.replaceAll(fixture, ''), contents)
  return SECRET_RULES.flatMap(({ id, pattern }) => {
  pattern.lastIndex = 0
  const count = [...redactedFixtures.matchAll(pattern)].length
  return count > 0 ? [{ path, ruleId: id, count }] : []
  })
}

const walk = (directory, root) => {
  if (!existsSync(directory)) return []
  const stat = lstatSync(directory)
  if (stat.isSymbolicLink()) return []
  if (stat.isFile()) return [relative(root, directory).replaceAll('\\', '/')]
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || ['node_modules', '.git', '.expo', '.supabase', '.wrangler'].includes(entry.name)) return []
    return walk(resolve(directory, entry.name), root)
  })
}

export const scanRepository = ({ root = process.cwd(), bundleDirectories = ['dist', 'mobile/dist', 'supabase/functions/dist'] } = {}) => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const bundleFiles = bundleDirectories.flatMap((directory) => walk(resolve(root, directory), root))
  const files = [...new Set([...tracked, ...bundleFiles])].filter((path) => !EXACT_EXCLUSIONS.has(path))
  return files.flatMap((path) => {
    const absolute = resolve(root, path)
    if (!existsSync(absolute) || !lstatSync(absolute).isFile() || !TEXT_EXTENSIONS.has(extname(path).toLocaleLowerCase())) return []
    const bytes = readFileSync(absolute)
    if (bytes.length > 8 * 1024 * 1024 || bytes.includes(0)) return []
    return scanSecretText(path, bytes.toString('utf8'))
  })
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const findings = scanRepository()
  for (const finding of findings) process.stderr.write(`${finding.path}\t${finding.ruleId}\t${finding.count}\n`)
  if (findings.length > 0) process.exitCode = 1
  else process.stdout.write('Secret scan passed.\n')
}
