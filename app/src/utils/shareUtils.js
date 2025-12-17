/**
 * Social Media Sharing Utilities
 * Handles sharing to various platforms
 */

/**
 * Generate shareable image from a card element (platform-optimized)
 */
export async function generateShareImage(cardElement, platform = 'default') {
  if (!cardElement) return null

  try {
    // Use html2canvas if available, otherwise return null
    const html2canvas = (await import('html2canvas')).default
    
    // Platform-specific optimizations
    const options = {
      backgroundColor: '#1a1a1a',
      scale: 2,
      logging: false,
      useCORS: true
    }
    
    // Instagram prefers square images (1080x1080)
    if (platform === 'instagram') {
      options.width = 1080
      options.height = 1080
    }
    
    // Twitter prefers 1200x675
    if (platform === 'twitter') {
      options.width = 1200
      options.height = 675
    }
    
    const canvas = await html2canvas(cardElement, options)
    
    // Track generation success
    try {
      const analyticsModule = await import('./shareAnalytics')
      const { trackShareCardGeneration } = analyticsModule || {}
      if (trackShareCardGeneration && typeof trackShareCardGeneration === 'function') {
        trackShareCardGeneration(platform, true)
      }
    } catch (analyticsError) {
      // Silently fail - analytics is non-critical
    }
    
    return canvas.toDataURL('image/png')
  } catch (error) {
    // Track generation failure
    try {
      const analyticsModule = await import('./shareAnalytics')
      const { trackShareCardGeneration } = analyticsModule || {}
      if (trackShareCardGeneration && typeof trackShareCardGeneration === 'function') {
        trackShareCardGeneration(platform, false)
      }
    } catch (e) {
      // Ignore analytics errors
    }
    return null
  }
}

/**
 * Share using Web Share API (native sharing on mobile)
 */
export async function shareNative(title, text, url, imageUrl = null) {
  if (!navigator.share) {
    return false
  }

  try {
    const shareData = {
      title,
      text,
      url
    }

    // If image is provided, convert data URL to File and attach
    if (imageUrl) {
      try {
        const response = await fetch(imageUrl)
        const blob = await response.blob()
        const file = new File([blob], 'echelon-share.png', { type: 'image/png' })
        
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          shareData.files = [file]
        }
      } catch (e) {
        // If file conversion fails, share without image
      }
    }

    await navigator.share(shareData)
    return true
  } catch (error) {
    // User cancelled or error occurred - silently fail
    if (error.name !== 'AbortError') {
      // Log only in development
      if (import.meta.env.DEV) {
        // Error sharing - silently fail (user cancelled or error)
      }
    }
    return false
  }
}

import { logError, logWarn } from './logger'
import { getTodayEST } from './dateUtils'

/**
 * Copy image to clipboard (works on Apple devices)
 */
export async function copyImageToClipboard(dataUrl) {
  try {
    // Convert data URL to blob
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    
    // Create ClipboardItem with proper MIME type
    const clipboardItem = new ClipboardItem({
      'image/png': blob
    })
    
    await navigator.clipboard.write([clipboardItem])
    return true
  } catch (error) {
    logWarn('Clipboard copy error', { message: error?.message })
    // Fallback: try using native share API
    try {
      if (navigator.share) {
        const response = await fetch(dataUrl)
        const blob = await response.blob()
        const file = new File([blob], 'echelon-share.png', { type: 'image/png' })
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Echelon Share'
          })
          return true
        }
      }
    } catch (shareError) {
      logWarn('Share fallback error', { message: shareError?.message })
    }
    return false
  }
}

/**
 * Download image
 */
export function downloadImage(dataUrl, filename) {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * Get share URLs for different platforms (optimized per platform)
 */
export function getShareUrls(type, data, achievements = []) {
  const baseUrl = window.location.origin
  const text = generateShareText(type, data, achievements)
  const encodedText = encodeURIComponent(text)
  const encodedUrl = encodeURIComponent(baseUrl)

  // Platform-specific optimizations
  const twitterText = text.length > 200 ? text.substring(0, 197) + '...' : text
  const linkedinText = text // LinkedIn allows longer text

  return {
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterText)}&url=${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}&summary=${encodeURIComponent(linkedinText)}`,
    reddit: `https://reddit.com/submit?url=${encodedUrl}&title=${encodedText}`,
    imessage: `sms:?body=${encodedText}%20${encodedUrl}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
  }
}

/**
 * Generate share text based on type and data (achievement-focused, no emojis)
 */
function generateShareText(type, data, achievements = []) {
  if (type === 'workout') {
    const { workout } = data
    const totalSeconds = workout?.duration || 0
    const totalMinutes = Math.floor(totalSeconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const duration = hours > 0 ? `${hours}h ${minutes}m` : `${totalMinutes}m`
    const exercises = workout?.exercises?.length || 0
    
    // Calculate volume
    let totalVolume = 0
    if (workout?.exercises) {
      workout.exercises.forEach(ex => {
        const sets = ex.sets || []
        sets.forEach(set => {
          const weight = Number(set.weight) || 0
          const reps = Number(set.reps) || 0
          totalVolume += weight * reps
        })
      })
    }
    const volumeK = totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : Math.round(totalVolume)
    
    // Build achievement-focused text
    const parts = []
    if (achievements.length > 0) {
      const prAchievement = achievements.find(a => a.type === 'pr')
      if (prAchievement) {
        parts.push(`New ${prAchievement.label}!`)
      }
      const milestone = achievements.find(a => a.type === 'milestone')
      if (milestone) {
        parts.push(milestone.label)
      }
    }
    
    parts.push(`${duration} workout`)
    parts.push(`${exercises} exercises`)
    if (totalVolume > 0) {
      parts.push(`${volumeK} lbs volume`)
    }
    
    return parts.join(' | ') + ' | Echelon Fitness'
  }
  
  if (type === 'nutrition') {
    const { nutrition } = data
    const calories = Number(nutrition?.calories) || 0
    const protein = Number(nutrition?.protein) || 0
    
    const parts = []
    if (achievements.length > 0) {
      parts.push(achievements[0].label)
    }
    parts.push(`${calories.toLocaleString()} calories`)
    if (protein > 0) {
      parts.push(`${Math.round(protein)}g protein`)
    }
    
    return parts.join(' | ') + ' | Echelon Nutrition'
  }
  
  if (type === 'health') {
    const { health } = data
    const steps = Number(health?.steps) || 0
    
    const parts = []
    if (achievements.length > 0) {
      parts.push(achievements[0].label)
    }
    if (steps > 0) {
      parts.push(`${steps.toLocaleString()} steps`)
    }
    
    return parts.join(' | ') + ' | Echelon Health'
  }
  
  return 'Check out my progress on Echelon Fitness'
}

/**
 * Open share URL in new window
 */
/**
 * Automatically share a workout to the feed
 * This is called when a workout is completed
 * Now saves to database instead of localStorage
 */
export async function shareWorkoutToFeed(workout, userId) {
  try {
    if (!userId) {
      // Fallback to localStorage if not logged in
      return shareWorkoutToFeedLocalStorage(workout)
    }

    const today = getTodayEST()
    const duration = workout.duration || 0
    const minutes = Math.floor(duration / 60)
    const seconds = duration % 60
    const sessionType = (workout.sessionType || workout.session_type || 'workout').toString().toLowerCase()
    const title = sessionType === 'recovery' ? 'Recovery Session' : (workout.templateName || 'Freestyle Workout')
    const subtitle = `${minutes}:${String(seconds).padStart(2, '0')}`

    const feedItem = {
      type: 'workout',
      date: workout.date || today,
      title,
      subtitle,
      data: workout,
      shared: true
    }

    // Save to database
    const { saveFeedItemToSupabase } = await import('../lib/db/feedDb')
    const saved = await saveFeedItemToSupabase(feedItem, userId)
    
    if (saved?.queued) {
      // Queued for eventual sync (offline-safe). Home feed will update when it flushes.
      return true
    }
    if (saved) {
      // Trigger a custom event to refresh the feed
      window.dispatchEvent(new CustomEvent('feedUpdated'))
      return true
    }
    
    // If database save failed (table doesn't exist), fallback to localStorage
    return shareWorkoutToFeedLocalStorage(workout)
  } catch (error) {
    // Silently ignore PGRST205 errors (table doesn't exist)
    if (error.code !== 'PGRST205' && !error.message?.includes('Could not find the table')) {
      logError('Error sharing workout to feed', error)
    }
    // Fallback to localStorage on error
    return shareWorkoutToFeedLocalStorage(workout)
  }
}

/**
 * Fallback: Share to localStorage (for offline or when database unavailable)
 */
function shareWorkoutToFeedLocalStorage(workout) {
  try {
    const today = getTodayEST()
    const duration = workout.duration || 0
    const minutes = Math.floor(duration / 60)
    const seconds = duration % 60
    const sessionType = (workout.sessionType || workout.session_type || 'workout').toString().toLowerCase()
    const title = sessionType === 'recovery' ? 'Recovery Session' : (workout.templateName || 'Freestyle Workout')
    const subtitle = `${minutes}:${String(seconds).padStart(2, '0')}`

    const feedItem = {
      type: 'workout',
      date: workout.date || today,
      title,
      subtitle,
      data: workout,
      shared: true,
      timestamp: new Date().toISOString()
    }

    let existing = []
    try {
      existing = JSON.parse(localStorage.getItem('sharedToFeed') || '[]')
    } catch (parseError) {
      logWarn('Error parsing localStorage feed data', { message: parseError?.message })
      localStorage.removeItem('sharedToFeed')
      existing = []
    }
    
    const now = new Date()
    const itemTime = new Date(feedItem.timestamp)
    const isDuplicate = existing.some(item => {
      if (item.type !== feedItem.type || item.date !== feedItem.date) {
        return false
      }
      const itemTimestamp = new Date(item.timestamp)
      const timeDiff = Math.abs(itemTime - itemTimestamp)
      return timeDiff < 60 * 60 * 1000
    })
    
    if (!isDuplicate) {
      existing.push(feedItem)
      const recent = existing.slice(-50)
      localStorage.setItem('sharedToFeed', JSON.stringify(recent))
      window.dispatchEvent(new CustomEvent('feedUpdated'))
      return true
    }
    return false
  } catch (error) {
    logError('Error sharing workout to localStorage', error)
    return false
  }
}

export function openShareUrl(url) {
  window.open(url, '_blank', 'width=600,height=400')
}

