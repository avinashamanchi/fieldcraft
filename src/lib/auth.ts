export interface AuthAccount {
  email: string
  passwordHash: string
  createdAt: string
}

export interface AuthSession {
  email: string
  expiresAt: number
}

const ACCOUNT_KEY = 'fieldcraft-auth-account'
const SESSION_KEY = 'fieldcraft-auth-session'
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000 // 30 days

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hashPassword(password: string, email: string): Promise<string> {
  return sha256(password + email.toLowerCase() + 'fc-salt-v1')
}

export function getAccount(): AuthAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    return raw ? (JSON.parse(raw) as AuthAccount) : null
  } catch {
    return null
  }
}

function saveAccount(account: AuthAccount): void {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
}

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as AuthSession
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

function createSession(email: string): void {
  const session: AuthSession = { email, expiresAt: Date.now() + SESSION_DURATION }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export async function createAccount(email: string, password: string): Promise<AuthAccount> {
  const passwordHash = await hashPassword(password, email)
  const account: AuthAccount = {
    email: email.toLowerCase().trim(),
    passwordHash,
    createdAt: new Date().toISOString(),
  }
  saveAccount(account)
  createSession(account.email)
  window.dispatchEvent(new CustomEvent('fieldcraft-auth-change'))
  return account
}

export async function loginWithPassword(email: string, password: string): Promise<boolean> {
  const account = getAccount()
  if (!account) return false
  if (account.email !== email.toLowerCase().trim()) return false
  const hash = await hashPassword(password, email)
  if (hash !== account.passwordHash) return false
  createSession(account.email)
  window.dispatchEvent(new CustomEvent('fieldcraft-auth-change'))
  return true
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new CustomEvent('fieldcraft-auth-change'))
}
