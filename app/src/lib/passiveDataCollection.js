/**
 * Passive Data Collection
 * Collects app usage patterns, session duration, feature engagement without explicit user action
 */

import { supabase } from './supabase'
import { trackEvent } from './eventTracking'
import { logError } from '../utils/logger'

const PASSIVE_ENABLED = import.meta.env.VITE_ENABLE_PASSIVE_COLLECTION === 'true'

let sessionStartTime = null
let lastActivityTime = null
let pageViewStartTime = null
let activityTimer = null
let sessionTimer = null
let initialized = false

/**
 * Initialize passive data collection
 */
export function initializePassiveCollection() {
  if (typeof window === 'undefined') return
  if (!PASSIVE_ENABLED) return
  if (initialized) return
  initialized = true
  
  sessionStartTime = Date.now()
  lastActivityTime = Date.now()
  pageViewStartTime = Date.now()
  
  // Track session start
  trackSessionStart()
  
  // Track page view duration
  trackPageViewDuration()
  
  // Track user activity
  setupActivityTracking()
  
  // Track feature discovery
  setupFeatureDiscovery()
  
  // Track on page unload
  window.addEventListener('beforeunload', trackSessionEnd)
  
  // Track visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

/**
 * Track session start
 */
function trackSessionStart() {
  trackEvent('session_start', {
    category: 'session',
    action: 'start',
    properties: {
      referrer: document.referrer,
      entry_url: window.location.href,
      timestamp: new Date().toISOString()
    }
  })
}

/**
 * Track session end
 */
function trackSessionEnd() {
  if (!sessionStartTime) return
  
  const sessionDuration = Math.round((Date.now() - sessionStartTime) / 1000) // seconds
  
  trackEvent('session_end', {
    category: 'session',
    action: 'end',
    properties: {
      duration_seconds: sessionDuration,
      exit_url: window.location.href,
      timestamp: new Date().toISOString()
    }
  })
  
  // Save session data
  saveSessionData(sessionDuration)
}

/**
 * Track page view duration
 */
function trackPageViewDuration() {
  // Track when page is viewed
  pageViewStartTime = Date.now()
  
  // Track when user leaves page
  window.addEventListener('beforeunload', () => {
    const duration = Math.round((Date.now() - pageViewStartTime) / 1000)
    trackEvent('page_view_duration', {
      category: 'engagement',
      action: 'duration',
      label: window.location.pathname,
      value: duration,
      properties: {
        page: window.location.pathname,
        duration_seconds: duration
      }
    })
  })
}

/**
 * Setup activity tracking (mouse movements, clicks, scrolls, keyboard)
 */
function setupActivityTracking() {
  let activityCount = 0
  const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart']
  
  activityEvents.forEach(eventType => {
    document.addEventListener(eventType, () => {
      lastActivityTime = Date.now()
      activityCount++
      
      // Track activity every 30 seconds
      if (activityTimer) clearTimeout(activityTimer)
      activityTimer = setTimeout(() => {
        trackEvent('user_activity', {
          category: 'engagement',
          action: 'active',
          properties: {
            activity_count: activityCount,
            time_since_last_activity: 0
          }
        })
        activityCount = 0
      }, 30000)
    }, { passive: true })
  })
  
  // Track idle time
  setInterval(() => {
    const idleTime = Math.round((Date.now() - lastActivityTime) / 1000)
    if (idleTime > 60) { // 1 minute of inactivity
      trackEvent('user_idle', {
        category: 'engagement',
        action: 'idle',
        properties: {
          idle_seconds: idleTime
        }
      })
    }
  }, 60000) // Check every minute
}

/**
 * Track feature discovery (when user hovers over or interacts with features)
 */
function setupFeatureDiscovery() {
  // Track when user hovers over interactive elements
  document.addEventListener('mouseover', (e) => {
    const element = e.target
    if (element.dataset?.feature) {
      trackEvent('feature_discovered', {
        category: 'discovery',
        action: 'hover',
        label: element.dataset.feature,
        properties: {
          feature: element.dataset.feature,
          element_type: element.tagName.toLowerCase()
        }
      })
    }
  }, { passive: true })
  
  // Track tooltip views
  document.addEventListener('focus', (e) => {
    const element = e.target
    if (element.title || element.getAttribute('aria-label')) {
      trackEvent('tooltip_viewed', {
        category: 'discovery',
        action: 'view',
        properties: {
          tooltip_text: element.title || element.getAttribute('aria-label'),
          element_type: element.tagName.toLowerCase()
        }
      })
    }
  }, true)
}

/**
 * Track user journey (navigation patterns)
 */
export function trackNavigation(from, to) {
  trackEvent('navigation', {
    category: 'navigation',
    action: 'navigate',
    properties: {
      from_page: from,
      to_page: to,
      navigation_type: 'route_change'
    }
  })
}

/**
 * Track feature engagement (time spent on feature)
 */
export function trackFeatureEngagement(featureName, startTime) {
  const duration = Math.round((Date.now() - startTime) / 1000)
  
  trackEvent('feature_engagement', {
    category: 'engagement',
    action: 'time_spent',
    label: featureName,
    value: duration,
    properties: {
      feature: featureName,
      duration_seconds: duration
    }
  })
}

/**
 * Track scroll depth
 */
export function setupScrollTracking() {
  let maxScroll = 0
  const scrollThresholds = [25, 50, 75, 90, 100]
  const trackedThresholds = new Set()
  
  window.addEventListener('scroll', () => {
    const scrollPercent = Math.round(
      ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100
    )
    
    if (scrollPercent > maxScroll) {
      maxScroll = scrollPercent
      
      // Track when user reaches each threshold
      scrollThresholds.forEach(threshold => {
        if (scrollPercent >= threshold && !trackedThresholds.has(threshold)) {
          trackedThresholds.add(threshold)
          trackEvent('scroll_depth', {
            category: 'engagement',
            action: 'scroll',
            properties: {
              scroll_percent: threshold,
              page: window.location.pathname
            }
          })
        }
      })
    }
  }, { passive: true })
}

/**
 * Handle visibility changes (tab focus/blur)
 */
function handleVisibilityChange() {
  if (!supabase) return
  if (document.hidden) {
    trackEvent('app_backgrounded', {
      category: 'session',
      action: 'background',
      properties: {
        timestamp: new Date().toISOString()
      }
    })
  } else {
    trackEvent('app_foregrounded', {
      category: 'session',
      action: 'foreground',
      properties: {
        timestamp: new Date().toISOString(),
        time_in_background: lastActivityTime ? Math.round((Date.now() - lastActivityTime) / 1000) : 0
      }
    })
    lastActivityTime = Date.now()
  }
}

/**
 * Save session data to database
 */
async function saveSessionData(duration) {
  try {
    if (!supabase) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    
    const { error } = await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        session_id: sessionStorage.getItem('session_id'),
        duration_seconds: duration,
        start_time: new Date(sessionStartTime).toISOString(),
        end_time: new Date().toISOString(),
        page_views: getPageViewCount(),
        interactions: getInteractionCount()
      })
    
    if (error) {
      logError('Error saving session data', error)
    }
  } catch (error) {
    logError('Error in saveSessionData', error)
  }
}

function getPageViewCount() {
  // This would be tracked separately
  return parseInt(sessionStorage.getItem('page_view_count') || '0')
}

function getInteractionCount() {
  // This would be tracked separately
  return parseInt(sessionStorage.getItem('interaction_count') || '0')
}

