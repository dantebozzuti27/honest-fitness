// Service Worker for HonestFitness PWA
// Provides basic offline support and caching
// SAFE MODE: Only caches static assets, never intercepts HTML to prevent blank screens

const CACHE_NAME = 'honest-fitness-v2'
const urlsToCache = [
  '/manifest.json',
  '/logo.jpg'
]

// Install event - cache resources (non-blocking, fail-safe)
self.addEventListener('install', (event) => {
  // Don't block installation if caching fails
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Cache only non-critical assets, never HTML
        return cache.addAll(urlsToCache).catch((err) => {
          console.warn('Service Worker: Some assets failed to cache (non-critical):', err)
        })
      })
      .catch((error) => {
        console.warn('Service Worker install error (non-critical):', error)
        // Continue installation even if caching fails
      })
  )
  // Immediately activate new service worker
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName).catch(() => {
                // Ignore deletion errors
              })
            }
          })
        )
      })
      .then(() => {
        // Claim clients immediately
        return self.clients.claim()
      })
      .catch((error) => {
        console.warn('Service Worker activate error (non-critical):', error)
        // Continue activation even if cleanup fails
        return self.clients.claim()
      })
  )
})

// Fetch event - SAFE: Only cache static assets, never HTML or API calls
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  
  // CRITICAL: Never intercept HTML requests - always fetch fresh
  // This prevents blank screens from cached broken HTML
  if (event.request.method === 'GET' && 
      event.request.destination === 'document') {
    // Always fetch HTML from network, never from cache
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          // Only if network completely fails, try cache as last resort
          return caches.match(event.request)
        })
    )
    return
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return
  }

  // Skip API requests, external resources, and dynamic content
  if (event.request.url.includes('/api/') ||
      event.request.url.includes('/_next/') ||
      event.request.url.includes('/static/') ||
      event.request.url.includes('?') || // Skip URLs with query params (dynamic)
      (url.origin !== self.location.origin)) {
    return
  }

  // Only cache static assets (images, fonts, CSS, JS from same origin)
  const isStaticAsset = /\.(jpg|jpeg|png|gif|svg|ico|woff|woff2|ttf|eot|css|js)$/i.test(url.pathname)
  
  if (!isStaticAsset) {
    // For non-static assets, always fetch from network
    return
  }

  // For static assets: try cache first, then network
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse
        }
        
        // Fetch from network
        return fetch(event.request)
          .then((response) => {
            // Only cache successful responses
            if (response && response.status === 200 && response.type === 'basic') {
              const responseToCache = response.clone()
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache).catch(() => {
                    // Ignore cache errors
                  })
                })
                .catch(() => {
                  // Ignore cache errors
                })
            }
            return response
          })
          .catch((error) => {
            // If fetch fails, return nothing (let browser handle it)
            console.warn('Service Worker fetch error (non-critical):', error)
            throw error
          })
      })
      .catch(() => {
        // If everything fails, let browser handle it naturally
        return fetch(event.request)
      })
  )
})

