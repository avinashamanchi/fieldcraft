import { execFileSync } from 'node:child_process'
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs'
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

const DEFAULT_BUNDLE_DIRECTORIES = ['dist', 'mobile/dist', 'supabase/functions/dist']

export const SECRET_RULES = [
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: 'provider-api-key', pattern: /\b(?:gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g },
  { id: 'stripe-secret', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]{16,}\b/g },
  { id: 'webhook-secret', pattern: /\bwhsec_[A-Za-z0-9_]{16,}\b/g },
  { id: 'bearer-token', pattern: /\bBearer[ \t]+(?!\$\{|<|REDACTED\b)[A-Za-z0-9._~+\/-]{24,}={0,2}\b/g },
  { id: 'jwt-token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    id: 'private-env-assignment',
    pattern: /\b(?:GROQ_API_KEY|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|AI_RATE_LIMIT_HMAC_SECRET|REVENUECAT_WEBHOOK_SECRET|REVENUECAT_WEBHOOK_SIGNING_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|REMINDER_PROVIDER_API_KEY|REMINDER_PROVIDER_WEBHOOK_SECRET|FIELDCRAFT_OBSERVABILITY_HMAC_SECRET|EXPO_TOKEN|APPLE_APP_SPECIFIC_PASSWORD)\b[ \t]*[:=][ \t]*["']?(?!\$\{|process\.env|Deno\.env|<|REDACTED\b|replace-me\b|set-in-\b|set-a-\b)[A-Za-z0-9._~+\/-]{12,}/g,
  },
]

const isBundlePath = (path, bundleDirectories) => bundleDirectories.some(
  (directory) => path === directory || path.startsWith(`${directory}/`),
)

export const scanSecretText = (
  path,
  contents,
  { publicBundleValues = [], bundleDirectories = DEFAULT_BUNDLE_DIRECTORIES } = {},
) => {
  const exactAllowedValues = isBundlePath(path, bundleDirectories)
    ? [...EXACT_PUBLIC_FIXTURES, ...publicBundleValues.filter((value) => typeof value === 'string' && value.length > 0)]
    : EXACT_PUBLIC_FIXTURES
  const redactedFixtures = exactAllowedValues.reduce((value, fixture) => value.replaceAll(fixture, ''), contents)
  return SECRET_RULES.flatMap(({ id, pattern }) => {
    pattern.lastIndex = 0
    const count = [...redactedFixtures.matchAll(pattern)].length
    return count > 0 ? [{ path, ruleId: id, count }] : []
  })
}

const readRegularFile = (absolute) => {
  let descriptor
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if (['ELOOP', 'ENOENT'].includes(error?.code)) return null
    throw error
  }
  try {
    if (!fstatSync(descriptor).isFile()) return null
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
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

export const scanRepository = ({
  root = process.cwd(),
  bundleDirectories = DEFAULT_BUNDLE_DIRECTORIES,
  publicBundleValues = [],
} = {}) => {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const bundleFiles = bundleDirectories.flatMap((directory) => walk(resolve(root, directory), root))
  const files = [...new Set([...tracked, ...bundleFiles])].filter((path) => !EXACT_EXCLUSIONS.has(path))
  return files.flatMap((path) => {
    const absolute = resolve(root, path)
    if (!TEXT_EXTENSIONS.has(extname(path).toLocaleLowerCase())) return []
    const bytes = readRegularFile(absolute)
    if (!bytes) return []
    if (bytes.length > 8 * 1024 * 1024 || bytes.includes(0)) return []
    return scanSecretText(path, bytes.toString('utf8'), { bundleDirectories, publicBundleValues })
  })
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const findings = scanRepository({
    publicBundleValues: [process.env.VITE_SUPABASE_ANON_KEY?.trim()].filter(Boolean),
  })
  for (const finding of findings) process.stderr.write(`${finding.path}\t${finding.ruleId}\t${finding.count}\n`)
  if (findings.length > 0) process.exitCode = 1
  else process.stdout.write('Secret scan passed.\n')
}
