import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from './context/AuthContext'
import { getTodayEST } from './utils/dateUtils'
import { lazy, Suspense } from 'react'
import BottomNav from './components/BottomNav'
import ErrorBoundary from './components/ErrorBoundary'
import { logWarn, logError } from './utils/logger'
import { setTemplateSyncUserId } from './db/lazyDb'

const Home = lazy(() => import('./pages/Home'))
const Auth = lazy(() => import('./pages/Auth'))
const Fitness = lazy(() => import('./pages/Fitness'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Profile = lazy(() => import('./pages/Profile'))
const ActiveWorkout = lazy(() => import('./pages/ActiveWorkout'))
const Progress = lazy(() => import('./pages/Progress'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
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

  // Keep template sync user ID in sync with auth state
  useEffect(() => {
    setTemplateSyncUserId(user?.id ?? null)
  }, [user])

  // Flush queued Supabase writes (offline -> eventual sync)
  useEffect(() => {
    if (!user) return

    import('./lib/syncOutbox')
      .then(({ migrateLegacyFailedWorkouts, flushOutbox }) => {
        migrateLegacyFailedWorkouts(user.id)
        flushOutbox(user.id).catch(() => {})
      })
      .catch(() => {})

    const onOnline = () => {
      import('./lib/syncOutbox')
        .then(({ flushOutbox }) => flushOutbox(user.id).catch(() => {}))
        .catch(() => {})
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [user])

  // Ensure local exercise cache exists
  useEffect(() => {
    if (!user) return
    import('./lib/exerciseBootstrap')
      .then(({ ensureLocalExercisesLoaded }) => ensureLocalExercisesLoaded().catch(() => {}))
      .catch(() => {})
  }, [user])

  // Start Fitbit token refresh interval
  useEffect(() => {
    if (!user) return
    let cleanup: (() => void) | null = null
    let cancelled = false
    import('./lib/tokenManager')
      .then(({ startTokenRefreshInterval }) => {
        if (cancelled) return
        cleanup = startTokenRefreshInterval(user.id)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (typeof cleanup === 'function') cleanup()
    }
  }, [user])
  
  // Auto-sync Fitbit data on app load (once per session, every 5 min)
  useEffect(() => {
    if (!user) return
    const syncKey = `wearable_sync_${user.id}_${getTodayEST()}`
    const lastSync = sessionStorage.getItem(syncKey)
    const now = Date.now()
    
    if (!lastSync || (now - parseInt(lastSync)) > 5 * 60 * 1000) {
      sessionStorage.setItem(syncKey, now.toString())
      import('./lib/wearables')
        .then(({ getAllConnectedAccounts, syncFitbitData }) => {
          return getAllConnectedAccounts(user.id).then((connected: any[]) => {
            if (!connected || connected.length === 0) return
            const fitbitAccount = connected.find((a: any) => a.provider === 'fitbit')
            if (fitbitAccount) {
              syncFitbitData(user.id, getTodayEST()).catch((err: any) => {
                logWarn('Auto-sync Fitbit failed', { message: err?.message })
              })
            }
          })
        })
        .catch((err) => logError('Error syncing Fitbit on load', err))
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
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/fitness" element={<ProtectedRoute><Fitness /></ProtectedRoute>} />
          <Route path="/workout" element={<ProtectedRoute><Fitness /></ProtectedRoute>} />
          <Route path="/workout/active" element={<ProtectedRoute><ActiveWorkout /></ProtectedRoute>} />
          <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
          <Route path="/progress" element={<ProtectedRoute><Progress /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/account" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      {user && <BottomNav />}
    </ErrorBoundary>
  )
}
