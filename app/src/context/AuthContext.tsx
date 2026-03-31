import type { ReactNode } from 'react'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  cognitoConfigOk,
  getCurrentSession,
  signIn as cognitoSignIn,
  signUp as cognitoSignUp,
  signOut as cognitoSignOut,
  confirmSignUp as cognitoConfirm,
  getIdToken,
  type AppUser,
} from '../lib/cognitoAuth'
import { apiUrl } from '../lib/urlConfig'
import { logWarn } from '../utils/logger'
import { trackEvent } from '../utils/analytics'

export type AuthContextValue = {
  user: AppUser | null
  loading: boolean
  signUp: (email: string, password: string, username: string, phoneNumber?: string | null) => Promise<any>
  signIn: (email: string, password: string) => Promise<any>
  signOut: () => Promise<void>
  confirmSignUp: (email: string, code: string) => Promise<void>
  needsConfirmation: boolean
  pendingEmail: string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function resolveUser(cognitoUser: AppUser): Promise<AppUser> {
  try {
    const token = await getIdToken()
    if (!token) return cognitoUser

    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const resolved = await res.json()
      if (resolved?.id) return { id: resolved.id, email: resolved.email || cognitoUser.email }
    }
  } catch {
    // fall back to cognito user if backend unreachable
  }
  return cognitoUser
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    if (!cognitoConfigOk) {
      logWarn('AuthContext: Cognito not configured; auth disabled')
      setUser(null)
      setLoading(false)
      return () => { mounted = false }
    }

    const timeoutId = setTimeout(() => {
      if (mounted) {
        logWarn('AuthContext: Loading timeout, proceeding without auth')
        setLoading(false)
      }
    }, 8000)

    getCurrentSession()
      .then(async (result) => {
        if (!mounted) return
        if (result) {
          const resolved = await resolveUser(result.user)
          if (mounted) setUser(resolved)
        }
        if (mounted) {
          setLoading(false)
          clearTimeout(timeoutId)
        }
      })
      .catch(() => {
        if (mounted) {
          setUser(null)
          setLoading(false)
          clearTimeout(timeoutId)
        }
      })

    return () => {
      mounted = false
      clearTimeout(timeoutId)
    }
  }, [])

  const handleSignUp = useCallback(async (email: string, password: string, username: string) => {
    const appUser = await cognitoSignUp(email, password)
    trackEvent('auth_sign_up', { userId: appUser.id })
    setNeedsConfirmation(true)
    setPendingEmail(email)
    return { user: appUser }
  }, [])

  const handleConfirmSignUp = useCallback(async (email: string, code: string) => {
    await cognitoConfirm(email, code)
    setNeedsConfirmation(false)
    setPendingEmail(null)
  }, [])

  const handleSignIn = useCallback(async (email: string, password: string) => {
    const appUser = await cognitoSignIn(email, password)
    const resolved = await resolveUser(appUser)
    setUser(resolved)
    trackEvent('auth_sign_in', { userId: resolved.id })
    return { user: resolved, session: {} }
  }, [])

  const handleSignOut = useCallback(async () => {
    await cognitoSignOut()
    setUser(null)
    trackEvent('auth_sign_out')
  }, [])

  const value: AuthContextValue = {
    user,
    loading,
    signUp: handleSignUp,
    signIn: handleSignIn,
    signOut: handleSignOut,
    confirmSignUp: handleConfirmSignUp,
    needsConfirmation,
    pendingEmail,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
