import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    
    // Set a timeout to stop loading even if Supabase fails
    const timeoutId = setTimeout(() => {
      if (mounted && loading) {
        console.warn('AuthContext: Loading timeout, proceeding without auth')
        setLoading(false)
      }
    }, 5000) // 5 second timeout
    
    // Get initial session with error handling
    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (!mounted) return
        if (error) {
          console.warn('AuthContext: Session error (non-critical):', error)
        }
        setUser(session?.user ?? null)
        setLoading(false)
        clearTimeout(timeoutId)
      })
      .catch((error) => {
        if (!mounted) return
        console.warn('AuthContext: Session fetch failed (non-critical):', error)
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
      console.warn('AuthContext: Failed to set up auth listener (non-critical):', error)
    }

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      if (subscription) {
        subscription.unsubscribe()
      }
    }
  }, [])

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })
    if (error) throw error
    return data
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    return data
  }

  const signOut = async () => {
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
