/**
 * URL configuration helpers (Web + iOS/Capacitor)
 *
 * Goal:
 * - Web (Vercel): use relative URLs for same-origin `/api/*`
 * - iOS/Capacitor: use absolute base (VITE_BACKEND_URL or VITE_PUBLIC_SITE_URL)
 */

function safeTrim(s: any) {
  return (s || '').toString().trim()
}

function stripTrailingSlash(s: string) {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

export function getPublicSiteUrl() {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {}
  const configured = safeTrim(env.VITE_PUBLIC_SITE_URL)
  const origin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : ''

  // In Capacitor, origin is typically `capacitor://localhost` which is not usable for HTTPS redirects.
  const originIsHttp = origin.startsWith('http://') || origin.startsWith('https://')
  if (!originIsHttp && configured) return stripTrailingSlash(configured)

  return stripTrailingSlash(configured || origin)
}

export function getApiBaseUrl() {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {}
  const explicit = safeTrim(env.VITE_BACKEND_URL)
  if (explicit) return stripTrailingSlash(explicit)

  // Web production: same-origin serverless on Vercel → relative is correct
  const isProd = Boolean(env.PROD)
  const origin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : ''
  const originIsHttp = origin.startsWith('http://') || origin.startsWith('https://')

  if (isProd && originIsHttp) return '' // relative

  // Dev: local backend default
  if (!isProd) return 'http://localhost:3001'

  // Prod + non-http origin (Capacitor): must be explicitly configured.
  const publicSite = safeTrim(env.VITE_PUBLIC_SITE_URL)
  if (publicSite) return stripTrailingSlash(publicSite)

  return ''
}

export function apiPath(path: any) {
  const p = (path || '').toString()
  if (!p) return ''
  return p.startsWith('/') ? p : `/${p}`
}

export function apiUrl(path: any) {
  const base = getApiBaseUrl()
  const p = apiPath(path)
  return base ? `${base}${p}` : p
}


