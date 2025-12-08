import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App'
import './styles/global.css'

// CRITICAL: Unregister ALL service workers immediately to prevent blank screens
// This ensures the app always loads fresh
if ('serviceWorker' in navigator) {
  // Immediately unregister all service workers on page load
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.unregister().catch(() => {})
    })
    // Clear all caches
    if ('caches' in window) {
      caches.keys().then((cacheNames) => {
        cacheNames.forEach((cacheName) => {
          caches.delete(cacheName).catch(() => {})
        })
      })
    }
  }).catch(() => {})
  
  // Also unregister on page load event
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().catch(() => {})
      })
    }).catch(() => {})
  })
  
  // Emergency: Unregister if page doesn't render within 3 seconds
  setTimeout(() => {
    const root = document.getElementById('root')
    if (root && root.children.length === 0) {
      console.warn('Page not rendering, unregistering service workers...')
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister().then(() => {
            window.location.reload()
          }).catch(() => {})
        })
      }).catch(() => {})
    }
  }, 3000)
}

// Ensure root element exists before rendering
const rootElement = document.getElementById('root')
if (!rootElement) {
  console.error('Root element not found!')
  document.body.innerHTML = '<div style="padding: 20px; color: white; background: black;">Error: Root element not found. Please refresh the page.</div>'
} else {
  // Add a fallback background immediately
  rootElement.style.minHeight = '100vh'
  rootElement.style.background = '#000000'
  rootElement.style.color = '#ffffff'
  
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <BrowserRouter>
            <AuthProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </AuthProvider>
          </BrowserRouter>
        </ErrorBoundary>
      </React.StrictMode>
    )
  } catch (error) {
    console.error('Failed to render app:', error)
    rootElement.innerHTML = `
      <div style="padding: 40px; text-align: center; color: white; background: black; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <h1 style="color: #ff453a; margin-bottom: 20px;">⚠️ Error Loading App</h1>
        <p style="margin-bottom: 30px; color: #a1a1a6;">Something went wrong. Please try:</p>
        <button onclick="window.location.reload()" style="padding: 16px 32px; background: white; color: black; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600;">
          Refresh Page
        </button>
        <p style="margin-top: 30px; color: #6e6e73; font-size: 12px;">If this persists, try clearing your browser cache</p>
      </div>
    `
  }
}
