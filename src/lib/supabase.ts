import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // We handle this manually due to HashRouter
  }
})

// Returns true if Supabase is actually configured (not placeholders)
export function isSupabaseConfigured(): boolean {
  return (
    !!supabaseUrl &&
    !!supabaseAnonKey &&
    !supabaseUrl.includes('placeholder') &&
    !supabaseAnonKey.includes('placeholder') &&
    supabaseUrl.startsWith('https://')
  )
}

// Call on app init to handle email verification callback
export async function handleAuthCallback(): Promise<void> {
  const search = window.location.search
  const hash = window.location.hash
  const params = new URLSearchParams(search)

  // Handle token_hash flow (Supabase v2 newer format for email verification)
  const tokenHash = params.get('token_hash')
  const type = params.get('type') as 'signup' | 'recovery' | 'email_change' | null
  if (tokenHash && type) {
    try {
      await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      window.history.replaceState(null, '', window.location.pathname + '#/')
    } catch (err) {
      console.error('token_hash verification error:', err)
    }
    return
  }

  // Handle PKCE code exchange (Supabase v2 default)
  if (search.includes('code=')) {
    const code = params.get('code') ?? ''
    if (code) {
      try {
        const { data } = await supabase.auth.exchangeCodeForSession(code)
        if (data.session) {
          window.history.replaceState(null, '', window.location.pathname + '#/')
        }
      } catch (err) {
        console.error('exchangeCodeForSession error:', err)
      }
    }
    return
  }

  // Handle implicit flow (access_token in hash, before HashRouter can intercept)
  // HashRouter uses #/route format; auth callbacks arrive as #access_token=...
  if (hash && hash.includes('access_token=') && !hash.startsWith('#/')) {
    const hashParams = new URLSearchParams(hash.slice(1))
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    if (accessToken && refreshToken) {
      try {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        window.history.replaceState(null, '', window.location.pathname + '#/')
      } catch (err) {
        console.error('setSession error:', err)
      }
    }
  }
}
