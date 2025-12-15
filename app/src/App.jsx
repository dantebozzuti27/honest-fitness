import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
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
import CommandPalette from './components/CommandPalette'
import DebugOverlay from './components/DebugOverlay'
import { initializePassiveCollection } from './lib/passiveDataCollection'
import { trackError, trackPageView, retryQueuedEvents } from './lib/eventTracking'
import { ensureLocalExercisesLoaded } from './lib/exerciseBootstrap'
import { logWarn, logError } from './utils/logger'
import { flushOutbox, migrateLegacyFailedWorkouts } from './lib/syncOutbox'

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
const Invite = lazy(() => import('./pages/Invite'))
const DataCatalog = lazy(() => import('./pages/DataCatalog'))
const Progress = lazy(() => import('./pages/Progress'))
const Planner = lazy(() => import('./pages/Planner'))
const Log = lazy(() => import('./pages/Log'))

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
  const location = useLocation()
  const { user } = useAuth()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [checkingOnboarding, setCheckingOnboarding] = useState(false)
  const lastRouteMarkRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now())
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  
  // Track page views on route change
  useEffect(() => {
    if (user && location.pathname) {
      const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const pageName = location.pathname === '/' ? 'home' : location.pathname.replace('/', '')
      // Approximate “route render” time: next frame after location change
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const end = typeof performance !== 'undefined' ? performance.now() : Date.now()
          const routeRenderMs = Math.max(0, end - start)
          const deltaSinceLastRouteMs = Math.max(0, start - (lastRouteMarkRef.current || start))
          lastRouteMarkRef.current = start
          trackPageView(pageName, {
            path: location.pathname,
            search: location.search,
            route_render_ms: Math.round(routeRenderMs),
            route_delta_ms: Math.round(deltaSinceLastRouteMs)
          })
        })
      })
    }
  }, [location.pathname, location.search, user])
  
  // Initialize event tracking and passive data collection
  useEffect(() => {
    if (!user) return
    
    // Initialize passive data collection
    initializePassiveCollection()
    
    // Retry any queued events from previous sessions
    retryQueuedEvents()
  }, [user])

  // Flush queued Supabase writes (offline → eventual sync)
  useEffect(() => {
    if (!user) return

    migrateLegacyFailedWorkouts(user.id)
    flushOutbox(user.id).catch(() => {})

    const onOnline = () => {
      flushOutbox(user.id).catch(() => {})
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [user])

  // Global command palette shortcut: Cmd/Ctrl + K
  useEffect(() => {
    if (!user) return
    const onKeyDown = (e) => {
      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [user])

  // Capture global errors (best-effort). Keeps production surfaces clean and measurable.
  useEffect(() => {
    if (!user) return
    const onError = (event) => {
      // event.error may be undefined for some resource errors
      const err = event?.error || new Error(event?.message || 'Unknown error')
      trackError(err, { properties: { source: 'window.error' } })
    }
    const onUnhandledRejection = (event) => {
      const reason = event?.reason
      const err = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection')
      trackError(err, { properties: { source: 'window.unhandledrejection' } })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [user])

  // Ensure local exercise cache exists (IndexedDB can be empty after storage clear or domain change)
  useEffect(() => {
    if (!user) return
    ensureLocalExercisesLoaded().catch(() => {})
  }, [user])
  
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
        logWarn('Could not check onboarding status', { message: error?.message, code: error?.code })
        setShowOnboarding(false)
      } finally {
        setCheckingOnboarding(false)
      }
    }

    // Delay check slightly to ensure app renders first (longer on mobile)
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    const delay = isMobile ? 500 : 100
    const timeoutId = setTimeout(checkOnboarding, delay)
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
            logWarn('Auto-sync Fitbit failed on app load', { message: err?.message, code: err?.code })
          })
        }
        
        // Sync Oura if connected
        if (ouraAccount) {
          syncOuraData(user.id, today).catch(err => {
            // Silently fail - will retry on next load
            logWarn('Auto-sync Oura failed on app load', { message: err?.message, code: err?.code })
          })
        }
      }).catch(err => {
        // Silently fail
        logError('Error checking connected accounts on app load', err)
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
      <DebugOverlay enabled={(() => {
        try {
          const params = new URLSearchParams(location?.search || '')
          return params.get('debug') === '1'
        } catch {
          return false
        }
      })()} />
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
          <Route path="/progress" element={<ProtectedRoute><Progress /></ProtectedRoute>} />
          <Route path="/planner" element={<ProtectedRoute><Planner /></ProtectedRoute>} />
          <Route path="/log" element={<ProtectedRoute><Log /></ProtectedRoute>} />
          <Route path="/goals" element={<ProtectedRoute><Goals /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/wearables" element={<ProtectedRoute><Wearables /></ProtectedRoute>} />
          <Route path="/invite/:identifier" element={<ProtectedRoute><Invite /></ProtectedRoute>} />
          <Route path="/data-catalog" element={<ProtectedRoute><DataCatalog /></ProtectedRoute>} />
          {/* Legacy routes for backward compatibility */}
          <Route path="/ghost-mode" element={<ProtectedRoute><Nutrition /></ProtectedRoute>} />
          <Route path="/account" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        </Routes>
      </Suspense>
      {/* BottomNav appears on all pages except auth */}
      {user && <BottomNav />}
      {user && (
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      {/* Show onboarding for new users (non-blocking, fail-safe) */}
      {user && !checkingOnboarding && showOnboarding && (
        <ErrorBoundary>
          <Onboarding onComplete={() => setShowOnboarding(false)} />
        </ErrorBoundary>
      )}
    </>
  )
}
