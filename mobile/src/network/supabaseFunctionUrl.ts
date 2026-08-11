const SUPABASE_PROJECT_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$/i

export const validateSupabaseFunctionUrl = (
  value: string,
  functionName: string,
  errorMessage: string,
): string => {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(errorMessage) }
  if (
    url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
    !SUPABASE_PROJECT_HOST.test(url.hostname) || url.pathname !== `/functions/v1/${functionName}`
  ) {
    throw new Error(errorMessage)
  }
  return url.toString()
}
