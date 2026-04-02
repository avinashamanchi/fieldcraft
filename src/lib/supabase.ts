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

  // Handle PKCE code exchange (Supabase v2 default)
  if (search.includes('code=')) {
    const code = new URLSearchParams(search).get('code') ?? ''
    if (code) {
      const { data } = await supabase.auth.exchangeCodeForSession(code)
      if (data.session) {
        // Clean URL and redirect to home
        window.history.replaceState(null, '', window.location.pathname + '#/')
      }
    }
    return
  }

  // Handle implicit flow (access_token in hash fragment, outside of HashRouter path)
  // With HashRouter the hash is like #/route, but auth callbacks come as #access_token=...
  if (hash && hash.includes('access_token=') && !hash.startsWith('#/')) {
    const hashContent = hash.slice(1)
    const params = new URLSearchParams(hashContent)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (accessToken && refreshToken) {
      await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      window.history.replaceState(null, '', window.location.pathname + '#/')
    }
  }
}
