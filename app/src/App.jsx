import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from './context/AuthContext'
import { startTokenRefreshInterval } from './lib/tokenManager'
import Home from './pages/Home'
import Fitness from './pages/Fitness'
import Nutrition from './pages/Nutrition'
import Health from './pages/Health'
import Calendar from './pages/Calendar'
import Analytics from './pages/Analytics'
import Goals from './pages/Goals'
import Profile from './pages/Profile'
import ActiveWorkout from './pages/ActiveWorkout'
import Auth from './pages/Auth'
import Wearables from './pages/Wearables'

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
  
  // Start token refresh interval when user is logged in
  useEffect(() => {
    if (user) {
      const cleanup = startTokenRefreshInterval(user.id)
      return cleanup
    }
  }, [user])
  
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
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
  )
}
