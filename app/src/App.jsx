import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from './context/AuthContext'
import { startTokenRefreshInterval } from './lib/tokenManager'
import Home from './pages/Home'
import Workout from './pages/Workout'
import Calendar from './pages/Calendar'
import ActiveWorkout from './pages/ActiveWorkout'
import Analytics from './pages/Analytics'
import Planner from './pages/Planner'
import Auth from './pages/Auth'
import GhostMode from './pages/GhostMode'
import Wearables from './pages/Wearables'
import Health from './pages/Health'
import DataExplorer from './pages/DataExplorer'

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
      <Route path="/workout" element={<ProtectedRoute><Workout /></ProtectedRoute>} />
      <Route path="/workout/active" element={<ProtectedRoute><ActiveWorkout /></ProtectedRoute>} />
      <Route path="/calendar" element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
      <Route path="/planner" element={<ProtectedRoute><Planner /></ProtectedRoute>} />
      <Route path="/ghost-mode" element={<ProtectedRoute><GhostMode /></ProtectedRoute>} />
      <Route path="/wearables" element={<ProtectedRoute><Wearables /></ProtectedRoute>} />
      <Route path="/health" element={<ProtectedRoute><Health /></ProtectedRoute>} />
      <Route path="/data" element={<ProtectedRoute><DataExplorer /></ProtectedRoute>} />
    </Routes>
  )
}
