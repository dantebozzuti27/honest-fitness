import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import ShareCard from './ShareCard'
import { generateShareImage, shareNative, copyImageToClipboard, downloadImage, getShareUrls, openShareUrl } from '../utils/shareUtils'
import styles from './ShareModal.module.css'

export default function ShareModal({ type, data, onClose }) {
  const [sharing, setSharing] = useState(false)
  const [imageDataUrl, setImageDataUrl] = useState(null)
  const [sharedToFeed, setSharedToFeed] = useState(false)
  const cardRef = useRef(null)

  useEffect(() => {
    // Generate image when modal opens
    const generateImage = async () => {
      if (cardRef.current) {
        const imageUrl = await generateShareImage(cardRef.current)
        setImageDataUrl(imageUrl)
      }
    }
    
    // Small delay to ensure card is rendered
    const timeoutId = setTimeout(generateImage, 100)
    
    // Cleanup timeout on unmount
    return () => clearTimeout(timeoutId)
  }, [type, data])

  const handleNativeShare = async () => {
    setSharing(true)
    try {
      const text = type === 'workout' 
        ? `Just completed a workout!`
        : type === 'nutrition'
        ? `Today's nutrition summary`
        : `Today's health metrics`
      
      // Use the generated image if available
      const imageToShare = imageDataUrl || (cardRef.current ? await generateShareImage(cardRef.current) : null)
      
      const shared = await shareNative(
        'Echelon',
        text,
        window.location.origin,
        imageToShare
      )
      
      if (shared) {
        onClose()
      }
    } catch (error) {
      console.error('Share error:', error)
    } finally {
      setSharing(false)
    }
  }

  const handleCopyImage = async () => {
    try {
      const imageToCopy = imageDataUrl || (cardRef.current ? await generateShareImage(cardRef.current) : null)
      if (!imageToCopy) {
        alert('Unable to generate image')
        return
      }
      
      const copied = await copyImageToClipboard(imageToCopy)
      if (copied) {
        alert('Image copied! You can paste it in Messages, Instagram, or any app.')
      } else {
        // Fallback: use native share which works better on iOS
        const response = await fetch(imageToCopy)
        const blob = await response.blob()
        const file = new File([blob], 'echelon-share.png', { type: 'image/png' })
        
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Echelon Share'
          })
        } else {
          downloadImage(imageToCopy, `echelon-${type}-${new Date().toISOString().split('T')[0]}.png`)
        }
      }
    } catch (error) {
      console.error('Error copying image:', error)
      alert('Unable to copy image. Try using the Share button instead.')
    }
  }

  const handleDownload = () => {
    if (imageDataUrl) {
      downloadImage(imageDataUrl, `echelon-${type}-${new Date().toISOString().split('T')[0]}.png`)
    } else {
      // Generate and download
      generateShareImage(cardRef.current).then(url => {
        if (url) {
          downloadImage(url, `echelon-${type}-${new Date().toISOString().split('T')[0]}.png`)
        }
      })
    }
  }

  const handleShareToFeed = () => {
    try {
      const today = new Date().toISOString().split('T')[0]
      let title = ''
      let subtitle = ''
      
      if (type === 'workout') {
        const workout = data.workout
        const duration = workout.duration || 0
        const minutes = Math.floor(duration / 60)
        const seconds = duration % 60
        title = workout.templateName || 'Freestyle Workout'
        subtitle = `${minutes}:${String(seconds).padStart(2, '0')}`
      } else if (type === 'nutrition') {
        const nutrition = data.nutrition
        title = 'Daily Nutrition'
        subtitle = `${nutrition.calories || 0} calories`
      } else if (type === 'health') {
        const health = data.health
        title = 'Health Metrics'
        const parts = []
        if (health.steps) parts.push(`${health.steps.toLocaleString()} steps`)
        if (health.hrv) parts.push(`HRV: ${Math.round(health.hrv)}ms`)
        if (health.sleep_time) {
          const h = Math.floor(health.sleep_time / 60)
          const m = Math.round(health.sleep_time % 60)
          parts.push(`Sleep: ${h}:${m.toString().padStart(2, '0')}`)
        }
        subtitle = parts.join(' • ') || 'Health data'
      }

      const feedItem = {
        type,
        date: type === 'workout' ? (data.workout?.date || today) : type === 'nutrition' ? (data.nutrition?.date || today) : (data.health?.date || today),
        title,
        subtitle,
        data: type === 'workout' ? data.workout : type === 'nutrition' ? data.nutrition : data.health,
        shared: true,
        timestamp: new Date().toISOString()
      }

      console.log('Sharing to feed:', feedItem)

      // Get existing shared items
      const existing = JSON.parse(localStorage.getItem('sharedToFeed') || '[]')
      
      // Check if this exact item already exists (prevent duplicates)
      const isDuplicate = existing.some(item => 
        item.type === feedItem.type && 
        item.date === feedItem.date && 
        item.title === feedItem.title &&
        item.timestamp === feedItem.timestamp
      )
      
      if (!isDuplicate) {
        existing.push(feedItem)
        
        // Keep only last 50 items
        const recent = existing.slice(-50)
        localStorage.setItem('sharedToFeed', JSON.stringify(recent))
        console.log('Saved to localStorage, total items:', recent.length)
        
        setSharedToFeed(true)
        
        // Trigger a custom event to refresh the feed
        window.dispatchEvent(new CustomEvent('feedUpdated'))
        
        // Also try to refresh if on Home page
        if (window.location.pathname === '/') {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('feedUpdated'))
          }, 100)
        }
      } else {
        console.log('Duplicate item, not adding to feed')
      }
    } catch (error) {
      console.error('Error sharing to feed:', error)
      alert('Failed to share to feed')
    }
  }

  const shareUrls = getShareUrls(type, data)

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Share Your {type === 'workout' ? 'Workout' : type === 'nutrition' ? 'Nutrition' : 'Health'} Summary</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        
        <div className={styles.cardPreview}>
          <div ref={cardRef}>
            <ShareCard type={type} data={data} />
          </div>
        </div>

        <div className={styles.shareOptions}>
          {/* Native Share (Mobile) */}
          {navigator.share && (
            <button 
              className={styles.shareBtn}
              onClick={handleNativeShare}
              disabled={sharing}
            >
              Share
            </button>
          )}

          {/* Copy Image */}
          <button 
            className={styles.shareBtn}
            onClick={handleCopyImage}
          >
            Copy Image
          </button>

          {/* Download */}
          <button 
            className={styles.shareBtn}
            onClick={handleDownload}
          >
            Download
          </button>

          {/* Share to Feed */}
          <button 
            className={`${styles.shareBtn} ${sharedToFeed ? styles.sharedToFeed : ''}`}
            onClick={handleShareToFeed}
            disabled={sharedToFeed}
          >
            {sharedToFeed ? '✓ Shared to Feed' : 'Share to Feed'}
          </button>

          {/* Social Platforms */}
          <div className={styles.socialGrid}>
            <button 
              className={styles.socialBtn}
              onClick={() => openShareUrl(shareUrls.twitter)}
              title="Share on X (Twitter)"
            >
              <span className={styles.socialIcon}>𝕏</span>
            </button>
            <button 
              className={styles.socialBtn}
              onClick={() => openShareUrl(shareUrls.facebook)}
              title="Share on Facebook"
            >
              <span className={styles.socialIcon}>f</span>
            </button>
            <button 
              className={styles.socialBtn}
              onClick={async () => {
                // For Instagram, use native share with image
                const imageToShare = imageDataUrl || (cardRef.current ? await generateShareImage(cardRef.current) : null)
                if (imageToShare && navigator.share) {
                  try {
                    const response = await fetch(imageToShare)
                    const blob = await response.blob()
                    const file = new File([blob], 'echelon-share.png', { type: 'image/png' })
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                      await navigator.share({
                        files: [file],
                        title: 'Echelon Share'
                      })
                      return
                    }
                  } catch (e) {
                    console.error('Instagram share error:', e)
                  }
                }
                // Fallback to download
                handleDownload()
              }}
              title="Share to Instagram (opens share sheet)"
            >
              <span className={styles.socialIcon}>IG</span>
            </button>
            <button 
              className={styles.socialBtn}
              onClick={async () => {
                // For iMessage, use native share with image if available
                const imageToShare = imageDataUrl || (cardRef.current ? await generateShareImage(cardRef.current) : null)
                if (imageToShare && navigator.share) {
                  try {
                    const response = await fetch(imageToShare)
                    const blob = await response.blob()
                    const file = new File([blob], 'echelon-share.png', { type: 'image/png' })
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                      await navigator.share({
                        files: [file],
                        title: 'Echelon Share'
                      })
                      return
                    }
                  } catch (e) {
                    console.error('iMessage share error:', e)
                  }
                }
                // Fallback to SMS link
                openShareUrl(shareUrls.imessage)
              }}
              title="Share via iMessage"
            >
              <span className={styles.socialIcon}>💬</span>
            </button>
          </div>
          <p className={styles.instagramNote}>
            Tap Copy Image to paste in any app, or use Share to open the native share sheet
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}

