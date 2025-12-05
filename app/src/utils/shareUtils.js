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

    if (imageUrl && navigator.canShare && navigator.canShare({ files: [new File([], 'share.png')] })) {
      // For files, we'd need to convert data URL to File
      // For now, just share text
    }

    await navigator.share(shareData)
    return true
  } catch (error) {
    // User cancelled or error occurred - silently fail
    if (error.name !== 'AbortError') {
      // Log only in development
      if (import.meta.env.DEV) {
        console.error('Error sharing:', error)
      }
    }
    return false
  }
}

/**
 * Copy image to clipboard
 */
export async function copyImageToClipboard(dataUrl) {
  try {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ])
    return true
  } catch (error) {
    // Silently fail - clipboard access may not be available
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
    whatsapp: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    // Note: Instagram doesn't support direct URL sharing
    // Users should download the image and upload to Instagram Stories manually
  }
}

/**
 * Generate share text based on type and data
 */
function generateShareText(type, data) {
  if (type === 'workout') {
    const { workout } = data
    const duration = workout?.duration ? `${Math.floor(workout.duration / 60)}h ${workout.duration % 60}m` : '0m'
    const exercises = workout?.exercises?.length || 0
    return `Just completed a ${duration} workout with ${exercises} exercises! 💪 #EchelonFitness`
  }
  
  if (type === 'nutrition') {
    const { nutrition } = data
    const calories = nutrition?.calories || 0
    return `Today's nutrition: ${calories.toLocaleString()} calories! 🥗 #EchelonNutrition`
  }
  
  if (type === 'health') {
    const { health } = data
    const steps = health?.steps || 0
    return `Health metrics: ${steps.toLocaleString()} steps today! 📊 #EchelonHealth`
  }
  
  return 'Check out my progress on Echelon! #EchelonFitness'
}

/**
 * Open share URL in new window
 */
export function openShareUrl(url) {
  window.open(url, '_blank', 'width=600,height=400')
}

