import type { ReactNode } from 'react'
import { createContext, useContext, useState, useEffect } from 'react'
import type { AuthResponse, AuthTokenResponsePassword, User } from '@supabase/supabase-js'
import { supabase, supabaseConfigErrorMessage } from '../lib/supabase'
import { logWarn } from '../utils/logger'
import { trackEvent } from '../utils/analytics'

export type AuthContextValue = {
  user: User | null
  loading: boolean
  signUp: (email: string, password: string, username: string, phoneNumber?: string | null) => Promise<AuthResponse['data']>
  signIn: (email: string, password: string) => Promise<AuthTokenResponsePassword['data']>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    let mounted = true

    // If Supabase isn't configured, proceed without auth (the app shell can still render).
    if (!supabase) {
      logWarn('AuthContext: Supabase not configured; auth disabled', { message: supabaseConfigErrorMessage })
      setUser(null)
      setLoading(false)
      return () => {
        mounted = false
      }
    }
    
    // Set a timeout to stop loading even if Supabase fails
    const timeoutId = setTimeout(() => {
      if (mounted) {
        logWarn('AuthContext: Loading timeout, proceeding without auth')
        setLoading(false)
      }
    }, 5000) // 5 second timeout
    
    // Get initial session with error handling
    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (!mounted) return
        if (error) {
          logWarn('AuthContext: Session error (non-critical)', { message: error?.message, code: error?.code })
        }
        setUser(session?.user ?? null)
        setLoading(false)
        clearTimeout(timeoutId)
      })
      .catch((error: unknown) => {
        if (!mounted) return
        const message = error instanceof Error ? error.message : String(error)
        const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined
        logWarn('AuthContext: Session fetch failed (non-critical)', { message, code })
        setUser(null)
        setLoading(false)
        clearTimeout(timeoutId)
      })

    // Listen for auth changes
    let subscription = null
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (mounted) {
          setUser(session?.user ?? null)
          setLoading(false)
        }
      })
      subscription = data?.subscription
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined
      logWarn('AuthContext: Failed to set up auth listener (non-critical)', { message, code })
    }

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      if (subscription) {
        subscription.unsubscribe()
      }
    }
  }, [])

  const signUp: AuthContextValue['signUp'] = async (email, password, username, phoneNumber) => {
    if (!supabase) throw new Error(supabaseConfigErrorMessage)
    // Sign up user
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })
    if (error) throw error
    trackEvent('auth_sign_up', { userId: data.user?.id })
    return data
  }

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    if (!supabase) throw new Error(supabaseConfigErrorMessage)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    trackEvent('auth_sign_in', { userId: data.user?.id })
    return data
  }

  const signOut: AuthContextValue['signOut'] = async () => {
    if (!supabase) throw new Error(supabaseConfigErrorMessage)
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    trackEvent('auth_sign_out')
  }

  const value: AuthContextValue = {
    user,
    loading,
    signUp,
    signIn,
    signOut,
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
