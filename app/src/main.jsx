import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App'
import './styles/global.css'

// Register Service Worker for PWA (non-blocking, fail-safe with error recovery)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Delay registration to ensure app loads first
    setTimeout(() => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered:', registration.scope)
          
          // Check for updates periodically
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'activated') {
                  console.log('Service Worker updated and activated')
                }
              })
            }
          })
        })
        .catch((error) => {
          // Silently fail - app should work without service worker
          console.warn('Service Worker registration failed (non-critical):', error)
        })
      
      // Safety: If service worker causes issues, unregister it
      // Check for service worker errors after a delay
      setTimeout(() => {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((registration) => {
            // If service worker is in a bad state, unregister it
            if (registration.active && registration.active.state === 'redundant') {
              console.warn('Service Worker is redundant, unregistering...')
              registration.unregister().catch(() => {})
            }
          })
        }).catch(() => {})
      }, 5000)
    }, 1000)
  })
  
  // Emergency recovery: If page fails to load, unregister service worker
  window.addEventListener('error', (event) => {
    if (event.message && event.message.includes('service-worker')) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister().catch(() => {})
        })
      }).catch(() => {})
    }
  }, true)
}

ReactDOM.createRoot(document.getElementById('root')).render(
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
