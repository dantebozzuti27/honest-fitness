/**
 * Share Analytics Tracking
 * Tracks share button clicks, platform usage, and share card generation
 */

import { logWarn } from './logger'

/**
 * Track share button click
 */
export function trackShareClick(platform, type, data) {
  try {
    const shareEvent = {
      event: 'share_click',
      platform,
      type,
      timestamp: new Date().toISOString(),
      data: {
        hasImage: !!data.image,
        hasAchievement: !!data.achievement
      }
    }
    
    // Store in localStorage for now (can be sent to analytics later)
    const existing = JSON.parse(localStorage.getItem('share_analytics') || '[]')
    existing.push(shareEvent)
    const recent = existing.slice(-100) // Keep last 100 events
    localStorage.setItem('share_analytics', JSON.stringify(recent))
    
    // Also send to analytics if available
    if (window.gtag) {
      window.gtag('event', 'share', {
        method: platform,
        content_type: type
      })
    }
  } catch (error) {
    logWarn('Error tracking share click', { message: error?.message })
  }
}

/**
 * Track share card generation
 */
export function trackShareCardGeneration(type, success) {
  try {
    const event = {
      event: 'share_card_generated',
      type,
      success,
      timestamp: new Date().toISOString()
    }
    
    const existing = JSON.parse(localStorage.getItem('share_analytics') || '[]')
    existing.push(event)
    const recent = existing.slice(-100)
    localStorage.setItem('share_analytics', JSON.stringify(recent))
  } catch (error) {
    logWarn('Error tracking share card generation', { message: error?.message })
  }
}

/**
 * Get share analytics summary
 */
export function getShareAnalytics() {
  try {
    const events = JSON.parse(localStorage.getItem('share_analytics') || '[]')
    
    const summary = {
      totalShares: events.filter(e => e.event === 'share_click').length,
      platformBreakdown: {},
      typeBreakdown: {},
      successRate: 0,
      recentShares: events.filter(e => e.event === 'share_click').slice(-10)
    }
    
    events.forEach(event => {
      if (event.event === 'share_click') {
        summary.platformBreakdown[event.platform] = (summary.platformBreakdown[event.platform] || 0) + 1
        summary.typeBreakdown[event.type] = (summary.typeBreakdown[event.type] || 0) + 1
      }
      
      if (event.event === 'share_card_generated') {
        const generated = events.filter(e => e.event === 'share_card_generated' && e.type === event.type)
        const successful = generated.filter(e => e.success).length
        summary.successRate = generated.length > 0 ? (successful / generated.length) * 100 : 0
      }
    })
    
    return summary
  } catch (error) {
    logWarn('Error getting share analytics', { message: error?.message })
    return {
      totalShares: 0,
      platformBreakdown: {},
      typeBreakdown: {},
      successRate: 0,
      recentShares: []
    }
  }
}

