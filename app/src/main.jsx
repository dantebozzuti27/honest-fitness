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
