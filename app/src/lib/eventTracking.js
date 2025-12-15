/**
 * Event Tracking Infrastructure
 * Comprehensive event tracking system for user interactions, feature usage, and behavioral analytics
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

// Event schema standardization
const EVENT_SCHEMA = {
  // User identification
  user_id: null,
  session_id: null,
  
  // Event details
  event_name: null, // e.g., 'button_click', 'page_view', 'feature_used'
  event_category: null, // e.g., 'navigation', 'workout', 'nutrition', 'social'
  event_action: null, // e.g., 'click', 'view', 'complete', 'error'
  event_label: null, // e.g., 'start_workout_button', 'analytics_page'
  
  // Contextual metadata
  timestamp: null,
  timezone: null,
  device_type: null, // 'mobile', 'tablet', 'desktop'
  device_info: null, // { os, browser, screen_size }
  app_version: null,
  network_type: null, // 'wifi', 'cellular', 'offline'
  battery_level: null,
  
  // Event properties
  properties: null, // JSONB for flexible event-specific data
  value: null, // Numeric value if applicable
  
  // User context
  page_url: null,
  referrer: null,
  user_agent: null,
  
  // Error tracking
  error_message: null,
  error_stack: null,
  error_type: null
}

/**
 * Track an event
 */
export async function trackEvent(eventName, properties = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return // Don't track for anonymous users (or implement anonymous tracking)
    
    // Get session ID (create if doesn't exist)
    let sessionId = sessionStorage.getItem('session_id')
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      sessionStorage.setItem('session_id', sessionId)
    }
    
    // Get device and context info
    const deviceInfo = getDeviceInfo()
    const context = getContextMetadata()
    
    // Build event
    const event = {
      user_id: user.id,
      session_id: sessionId,
      event_name: eventName,
      event_category: properties.category || inferCategory(eventName),
      event_action: properties.action || inferAction(eventName),
      event_label: properties.label || eventName,
      timestamp: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      device_type: getDeviceType(),
      device_info: deviceInfo,
      app_version: import.meta.env.VITE_APP_VERSION || '1.0.0',
      network_type: await getNetworkType(),
      battery_level: getBatteryLevel(),
      properties: properties.properties || properties,
      value: properties.value || null,
      page_url: window.location.href,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent
    }
    
    // Save to Supabase events table
    const { error } = await supabase
      .from('user_events')
      .insert(event)
    
    if (error) {
      logError('Error tracking event', error)
      // Fallback: store in localStorage for retry
      queueEventForRetry(event)
    }
  } catch (error) {
    logError('Error in trackEvent', error)
  }
}

/**
 * Track page view
 */
export function trackPageView(pageName, properties = {}) {
  trackEvent('page_view', {
    category: 'navigation',
    action: 'view',
    label: pageName,
    ...properties
  })
}

/**
 * Track button click
 */
export function trackButtonClick(buttonName, properties = {}) {
  trackEvent('button_click', {
    category: 'interaction',
    action: 'click',
    label: buttonName,
    ...properties
  })
}

/**
 * Track feature usage
 */
export function trackFeatureUsage(featureName, properties = {}) {
  trackEvent('feature_used', {
    category: 'feature',
    action: 'use',
    label: featureName,
    ...properties
  })
}

/**
 * Track conversion event
 */
export function trackConversion(conversionType, value = null, properties = {}) {
  trackEvent('conversion', {
    category: 'conversion',
    action: 'complete',
    label: conversionType,
    value,
    ...properties
  })
}

/**
 * Track error
 */
export function trackError(error, context = {}) {
  trackEvent('error', {
    category: 'error',
    action: 'occurred',
    label: error.name || 'Unknown Error',
    error_message: error.message,
    error_stack: error.stack,
    error_type: error.name,
    ...context
  })
}

/**
 * Track workout events
 */
export function trackWorkoutEvent(action, workoutId = null, properties = {}) {
  trackEvent('workout_event', {
    category: 'workout',
    action,
    label: `workout_${action}`,
    properties: {
      workout_id: workoutId,
      ...properties
    }
  })
}

/**
 * Track nutrition events
 */
export function trackNutritionEvent(action, mealId = null, properties = {}) {
  trackEvent('nutrition_event', {
    category: 'nutrition',
    action,
    label: `nutrition_${action}`,
    properties: {
      meal_id: mealId,
      ...properties
    }
  })
}

/**
 * Track health metric events
 */
export function trackHealthEvent(action, metricType = null, properties = {}) {
  trackEvent('health_event', {
    category: 'health',
    action,
    label: `health_${action}`,
    properties: {
      metric_type: metricType,
      ...properties
    }
  })
}

// Helper functions

function inferCategory(eventName) {
  if (eventName.includes('workout')) return 'workout'
  if (eventName.includes('nutrition') || eventName.includes('meal')) return 'nutrition'
  if (eventName.includes('health') || eventName.includes('metric')) return 'health'
  if (eventName.includes('social') || eventName.includes('friend')) return 'social'
  if (eventName.includes('goal')) return 'goals'
  if (eventName.includes('page') || eventName.includes('view')) return 'navigation'
  if (eventName.includes('error')) return 'error'
  return 'general'
}

function inferAction(eventName) {
  if (eventName.includes('click')) return 'click'
  if (eventName.includes('view')) return 'view'
  if (eventName.includes('complete') || eventName.includes('finish')) return 'complete'
  if (eventName.includes('start') || eventName.includes('begin')) return 'start'
  if (eventName.includes('delete') || eventName.includes('remove')) return 'delete'
  if (eventName.includes('create') || eventName.includes('add')) return 'create'
  if (eventName.includes('update') || eventName.includes('edit')) return 'update'
  return 'unknown'
}

function getDeviceInfo() {
  return {
    os: navigator.platform,
    browser: getBrowserName(),
    screen_size: `${window.screen.width}x${window.screen.height}`,
    viewport_size: `${window.innerWidth}x${window.innerHeight}`,
    pixel_ratio: window.devicePixelRatio || 1,
    language: navigator.language,
    timezone_offset: new Date().getTimezoneOffset()
  }
}

function getBrowserName() {
  const ua = navigator.userAgent
  if (ua.includes('Chrome')) return 'Chrome'
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari'
  if (ua.includes('Edge')) return 'Edge'
  return 'Unknown'
}

function getDeviceType() {
  const width = window.innerWidth
  if (width < 768) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

async function getNetworkType() {
  if ('connection' in navigator) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    return connection?.effectiveType || 'unknown'
  }
  return 'unknown'
}

function getBatteryLevel() {
  if ('getBattery' in navigator) {
    navigator.getBattery().then(battery => {
      return Math.round(battery.level * 100)
    }).catch(() => null)
  }
  return null
}

function getContextMetadata() {
  return {
    timestamp: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    url: window.location.href,
    path: window.location.pathname,
    referrer: document.referrer
  }
}

// Queue failed events for retry
function queueEventForRetry(event) {
  try {
    const queued = JSON.parse(localStorage.getItem('queued_events') || '[]')
    queued.push(event)
    // Keep only last 100 events
    if (queued.length > 100) {
      queued.shift()
    }
    localStorage.setItem('queued_events', JSON.stringify(queued))
  } catch (e) {
    // Ignore localStorage errors
  }
}

/**
 * Retry queued events (call on app load)
 */
export async function retryQueuedEvents() {
  try {
    const queued = JSON.parse(localStorage.getItem('queued_events') || '[]')
    if (queued.length === 0) return
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    
    // Retry all queued events
    for (const event of queued) {
      const { error } = await supabase
        .from('user_events')
        .insert(event)
      
      if (!error) {
        // Remove from queue on success
        const updated = queued.filter(e => e !== event)
        localStorage.setItem('queued_events', JSON.stringify(updated))
      }
    }
  } catch (error) {
    logError('Error retrying queued events', error)
  }
}

