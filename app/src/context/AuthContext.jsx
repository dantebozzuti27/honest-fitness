import { createContext, useContext, useState, useEffect } from 'react'
import { supabase, supabaseConfigErrorMessage } from '../lib/supabase'
import { getOrCreateUserProfile } from '../lib/friendsDb'
import { logError, logWarn } from '../utils/logger'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

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
      .catch((error) => {
        if (!mounted) return
        logWarn('AuthContext: Session fetch failed (non-critical)', { message: error?.message, code: error?.code })
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
    } catch (error) {
      logWarn('AuthContext: Failed to set up auth listener (non-critical)', { message: error?.message, code: error?.code })
    }

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      if (subscription) {
        subscription.unsubscribe()
      }
    }
  }, [])

  const signUp = async (email, password, username, phoneNumber) => {
    if (!supabase) throw new Error(supabaseConfigErrorMessage)
    // Sign up user
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })
    if (error) throw error
    
    // Create user profile with username and phone number
    if (data.user) {
      try {
        await getOrCreateUserProfile(data.user.id, {
          username,
          phone_number: phoneNumber || null,
          display_name: username // Default display name to username
        })
      } catch (profileError) {
        // Log error but don't fail signup - profile can be created later
        logError('Error creating user profile', profileError)
      }
    }
    
    return data
  }

  const signIn = async (email, password) => {
    if (!supabase) throw new Error(supabaseConfigErrorMessage)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    return data
  }

  const signOut = async () => {
    if (!supabase) throw new Error(supabaseConfigErrorMessage)
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const value = {
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
