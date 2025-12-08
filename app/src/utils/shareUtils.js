/**
 * Social Media Sharing Utilities
 * Handles sharing to various platforms
 */

/**
 * Generate shareable image from a card element
 */
export async function generateShareImage(cardElement) {
  if (!cardElement) return null

  try {
    // Use html2canvas if available, otherwise return null
    const html2canvas = (await import('html2canvas')).default
    
    const canvas = await html2canvas(cardElement, {
      backgroundColor: '#1a1a1a',
      scale: 2,
      logging: false,
      useCORS: true
    })
    
    return canvas.toDataURL('image/png')
  } catch (error) {
    // Silently fail - image generation is optional
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
    console.error('Clipboard copy error:', error)
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
      console.error('Share fallback error:', shareError)
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
 * Get share URLs for different platforms
 */
export function getShareUrls(type, data) {
  const baseUrl = window.location.origin
  const text = generateShareText(type, data)
  const encodedText = encodeURIComponent(text)
  const encodedUrl = encodeURIComponent(baseUrl)

  return {
    twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    reddit: `https://reddit.com/submit?url=${encodedUrl}&title=${encodedText}`,
    imessage: `sms:?body=${encodedText}%20${encodedUrl}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
  }
}

/**
 * Generate share text based on type and data
 */
function generateShareText(type, data) {
  if (type === 'workout') {
    const { workout } = data
    // Duration is in SECONDS, convert to minutes for display
    const totalSeconds = workout?.duration || 0
    const totalMinutes = Math.floor(totalSeconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const duration = hours > 0 ? `${hours}h ${minutes}m` : `${totalMinutes}m`
    const exercises = workout?.exercises?.length || 0
    return `Just completed a ${duration} workout with ${exercises} exercises! #EchelonFitness`
  }
  
  if (type === 'nutrition') {
    const { nutrition } = data
    const calories = nutrition?.calories || 0
    return `Today's nutrition: ${calories.toLocaleString()} calories! #EchelonNutrition`
  }
  
  if (type === 'health') {
    const { health } = data
    const steps = health?.steps || 0
    return `Health metrics: ${steps.toLocaleString()} steps today! #EchelonHealth`
  }
  
  return 'Check out my progress on Echelon! #EchelonFitness'
}

/**
 * Open share URL in new window
 */
/**
 * Automatically share a workout to the feed
 * This is called when a workout is completed
 */
export function shareWorkoutToFeed(workout) {
  try {
    const today = new Date().toISOString().split('T')[0]
    const duration = workout.duration || 0
    const minutes = Math.floor(duration / 60)
    const seconds = duration % 60
    const title = workout.templateName || 'Freestyle Workout'
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

    // Get existing shared items
    const existing = JSON.parse(localStorage.getItem('sharedToFeed') || '[]')
    
    // Check if this exact item already exists (prevent duplicates)
    // Use a more lenient check - same type and date within the same hour
    const now = new Date()
    const itemTime = new Date(feedItem.timestamp)
    const isDuplicate = existing.some(item => {
      if (item.type !== feedItem.type || item.date !== feedItem.date) {
        return false
      }
      // Check if timestamp is within the same hour (to allow multiple workouts per day)
      const itemTimestamp = new Date(item.timestamp)
      const timeDiff = Math.abs(itemTime - itemTimestamp)
      return timeDiff < 60 * 60 * 1000 // Within 1 hour
    })
    
    if (!isDuplicate) {
      existing.push(feedItem)
      
      // Keep only last 50 items
      const recent = existing.slice(-50)
      localStorage.setItem('sharedToFeed', JSON.stringify(recent))
      
      // Trigger a custom event to refresh the feed
      window.dispatchEvent(new CustomEvent('feedUpdated'))
      
      return true
    } else {
      return false // Duplicate, not added
    }
  } catch (error) {
    console.error('Error sharing workout to feed:', error)
    return false
  }
}

export function openShareUrl(url) {
  window.open(url, '_blank', 'width=600,height=400')
}

