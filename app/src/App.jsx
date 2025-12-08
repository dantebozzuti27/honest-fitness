import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from './context/AuthContext'
import { startTokenRefreshInterval } from './lib/tokenManager'
import { getAllConnectedAccounts, syncFitbitData, syncOuraData } from './lib/wearables'
import { getTodayEST } from './utils/dateUtils'
import { getUserPreferences } from './lib/supabaseDb'
import { lazy, Suspense } from 'react'
import Home from './pages/Home'
import Auth from './pages/Auth'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import BottomNav from './components/BottomNav'
import Onboarding from './components/Onboarding'
import ErrorBoundary from './components/ErrorBoundary'

// Lazy load heavy components for code splitting
const Fitness = lazy(() => import('./pages/Fitness'))
const Nutrition = lazy(() => import('./pages/Nutrition'))
const Health = lazy(() => import('./pages/Health'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Goals = lazy(() => import('./pages/Goals'))
const Profile = lazy(() => import('./pages/Profile'))
const ActiveWorkout = lazy(() => import('./pages/ActiveWorkout'))
const Wearables = lazy(() => import('./pages/Wearables'))

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        color: 'var(--text-secondary)'
      }}>
        Loading...
      </div>
    )
  }
  
  if (!user) {
    return <Navigate to="/auth" replace />
  }
  
  return children
}

export default function App() {
  const { user } = useAuth()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [checkingOnboarding, setCheckingOnboarding] = useState(false)
  
  // Check if user needs onboarding (non-blocking, runs after initial render)
  useEffect(() => {
    if (!user) {
      setShowOnboarding(false)
      return
    }

    // Set checking to true briefly, then check
    setCheckingOnboarding(true)
    
    const checkOnboarding = async () => {
      try {
        const prefs = await getUserPreferences(user.id)
        // Safely check onboarding_completed (column may not exist yet)
        const completed = prefs?.onboarding_completed === true
        setShowOnboarding(!completed)
      } catch (error) {
        // If error (e.g., column doesn't exist), don't show onboarding
        // User can complete it later when the migration is run
        console.warn('Could not check onboarding status:', error)
        setShowOnboarding(false)
      } finally {
        setCheckingOnboarding(false)
      }
    }

    // Delay check slightly to ensure app renders first
    const timeoutId = setTimeout(checkOnboarding, 100)
    return () => clearTimeout(timeoutId)
  }, [user])
  
  // Start token refresh interval when user is logged in
  useEffect(() => {
    if (user) {
      const cleanup = startTokenRefreshInterval(user.id)
      return cleanup
    }
  }, [user])
  
  // Auto-sync wearable data when app loads (once per session)
  useEffect(() => {
    if (!user) return
    
    let hasSynced = false
    const syncKey = `wearable_sync_${user.id}_${getTodayEST()}`
    
    // Check if we've already synced today (avoid multiple syncs)
    const lastSync = sessionStorage.getItem(syncKey)
    const now = Date.now()
    
    // Only sync if we haven't synced in the last 5 minutes
    if (!lastSync || (now - parseInt(lastSync)) > 5 * 60 * 1000) {
      hasSynced = true
      sessionStorage.setItem(syncKey, now.toString())
      
      // Sync wearable data in background (non-blocking)
      getAllConnectedAccounts(user.id).then(connected => {
        if (!connected || connected.length === 0) return
        
        const fitbitAccount = connected.find(a => a.provider === 'fitbit')
        const ouraAccount = connected.find(a => a.provider === 'oura')
        const today = getTodayEST()
        
        // Sync Fitbit if connected
        if (fitbitAccount) {
          syncFitbitData(user.id, today).catch(err => {
            // Silently fail - will retry on next load
            console.error('Auto-sync Fitbit failed on app load:', err)
          })
        }
        
        // Sync Oura if connected
        if (ouraAccount) {
          syncOuraData(user.id, today).catch(err => {
            // Silently fail - will retry on next load
            console.error('Auto-sync Oura failed on app load:', err)
          })
        }
      }).catch(err => {
        // Silently fail
        console.error('Error checking connected accounts on app load:', err)
      })
    }
  }, [user])
  
  const LoadingFallback = () => (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      color: 'var(--text-secondary)'
    }}>
      Loading...
    </div>
  )

  return (
    <>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/fitness" element={<ProtectedRoute><Fitness /></ProtectedRoute>} />
          <Route path="/workout" element={<ProtectedRoute><Fitness /></ProtectedRoute>} />
          <Route path="/workout/active" element={<ProtectedRoute><ActiveWorkout /></ProtectedRoute>} />
          <Route path="/nutrition" element={<ProtectedRoute><Nutrition /></ProtectedRoute>} />
          <Route path="/health" element={<ProtectedRoute><Health /></ProtectedRoute>} />
          <Route path="/calendar" element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
          <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
          <Route path="/goals" element={<ProtectedRoute><Goals /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/wearables" element={<ProtectedRoute><Wearables /></ProtectedRoute>} />
          {/* Legacy routes for backward compatibility */}
          <Route path="/ghost-mode" element={<ProtectedRoute><Nutrition /></ProtectedRoute>} />
          <Route path="/account" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        </Routes>
      </Suspense>
      {/* BottomNav appears on all pages except auth */}
      {user && <BottomNav />}
      {/* Show onboarding for new users (non-blocking, fail-safe) */}
      {user && !checkingOnboarding && showOnboarding && (
        <ErrorBoundary>
          <Onboarding onComplete={() => setShowOnboarding(false)} />
        </ErrorBoundary>
      )}
    </>
  )
}
