import { supabase } from './supabase'

export async function signUp(email: string, password: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: 'https://avinashamanchi.github.io/fieldcraft/',
    },
  })
  if (error) return { error: error.message }
  return { error: null }
}

export async function signIn(email: string, password: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }
  return { error: null }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

export async function resendVerification(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: 'https://avinashamanchi.github.io/fieldcraft/' },
  })
  if (error) return { error: error.message }
  return { error: null }
}

export function getCurrentUser() {
  return supabase.auth.getUser()
}

export function onAuthStateChange(callback: (event: string, session: unknown) => void) {
  return supabase.auth.onAuthStateChange(callback)
}
