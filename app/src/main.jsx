import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App'
import { supabaseConfigOk, supabaseConfigErrorMessage } from './lib/supabase'
import './styles/global.css'

/**
 * Service Worker strategy
 * - Register the (safe-mode) SW for faster repeat loads/offline resilience.
 * - Keep a watchdog: if the app fails to render, recover by unregistering + cache clear once.
 */
if ('serviceWorker' in navigator) {
  // Register after load so it never blocks first paint.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })

  // Recovery watchdog: if the root never renders, try the "nuke SW" fix once per session.
  const RECOVERY_FLAG = 'sw_recovery_attempted'
  setTimeout(() => {
    try {
      const root = document.getElementById('root')
      const alreadyAttempted = sessionStorage.getItem(RECOVERY_FLAG) === '1'
      if (!root || root.children.length > 0 || alreadyAttempted) return

      sessionStorage.setItem(RECOVERY_FLAG, '1')
      console.warn('Page not rendering — attempting service worker recovery...')

      navigator.serviceWorker.getRegistrations().then((registrations) => {
        return Promise.allSettled(registrations.map((r) => r.unregister()))
      }).finally(() => {
        if ('caches' in window) {
          caches.keys()
            .then((names) => Promise.allSettled(names.map((n) => caches.delete(n))))
            .finally(() => window.location.reload())
        } else {
          window.location.reload()
        }
      })
    } catch {
      // If anything goes sideways, don't make it worse.
    }
  }, 3500)
}

// Ensure root element exists before rendering
const rootElement = document.getElementById('root')
if (!rootElement) {
  console.error('Root element not found!')
  // Use textContent instead of innerHTML for security
  const errorDiv = document.createElement('div')
  errorDiv.style.cssText = 'padding: 20px; color: white; background: black;'
  errorDiv.textContent = 'Error: Root element not found. Please refresh the page.'
  document.body.appendChild(errorDiv)
} else {
  // Add a fallback background immediately
  rootElement.style.minHeight = '100vh'
  rootElement.style.background = '#000000'
  rootElement.style.color = '#ffffff'
  
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          {supabaseConfigOk ? (
            <BrowserRouter>
              <AuthProvider>
                <ErrorBoundary>
                  <App />
                </ErrorBoundary>
              </AuthProvider>
            </BrowserRouter>
          ) : (
            <div style={{
              minHeight: '100dvh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
              background: '#000',
              color: '#fff',
              textAlign: 'center'
            }}>
              <h1 style={{ marginBottom: 12, fontSize: 22, color: '#ff453a' }}>App configuration error</h1>
              <p style={{ maxWidth: 720, color: '#a1a1a6', marginBottom: 16 }}>
                {supabaseConfigErrorMessage}
              </p>
              <p style={{ maxWidth: 720, color: '#a1a1a6', fontSize: 13, lineHeight: 1.4 }}>
                If you’re on Vercel: Project → Settings → Environment Variables → add
                <br />
                <code style={{ color: '#fff' }}>VITE_SUPABASE_URL</code> and <code style={{ color: '#fff' }}>VITE_SUPABASE_ANON_KEY</code>, then redeploy.
              </p>
            </div>
          )}
        </ErrorBoundary>
      </React.StrictMode>
    )
  } catch (error) {
    console.error('Failed to render app:', error)
    // Use createElement instead of innerHTML for security
    rootElement.textContent = '' // Clear existing content
    const container = document.createElement('div')
    container.style.cssText = 'padding: 40px; text-align: center; color: white; background: black; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;'
    
    const h1 = document.createElement('h1')
    h1.style.cssText = 'color: #ff453a; margin-bottom: 20px;'
    h1.textContent = 'Error Loading App'
    container.appendChild(h1)
    
    const p1 = document.createElement('p')
    p1.style.cssText = 'margin-bottom: 30px; color: #a1a1a6;'
    p1.textContent = 'Something went wrong. Please try:'
    container.appendChild(p1)
    
    const button = document.createElement('button')
    button.style.cssText = 'padding: 16px 32px; background: white; color: black; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600;'
    button.textContent = 'Refresh Page'
    button.onclick = () => window.location.reload()
    container.appendChild(button)
    
    const p2 = document.createElement('p')
    p2.style.cssText = 'margin-top: 30px; color: #6e6e73; font-size: 12px;'
    p2.textContent = 'If this persists, try clearing your browser cache'
    container.appendChild(p2)
    
    rootElement.appendChild(container)
  }
}
