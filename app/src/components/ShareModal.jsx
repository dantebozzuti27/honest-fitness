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
    if (!imageDataUrl) {
      // Regenerate if needed
      const imageUrl = await generateShareImage(cardRef.current)
      if (imageUrl) {
        const copied = await copyImageToClipboard(imageUrl)
        if (copied) {
          alert('Image copied to clipboard!')
        } else {
          downloadImage(imageUrl, `echelon-${type}-${new Date().toISOString().split('T')[0]}.png`)
        }
      }
      return
    }
    
    const copied = await copyImageToClipboard(imageDataUrl)
    if (copied) {
      alert('Image copied to clipboard!')
    } else {
      downloadImage(imageDataUrl, `echelon-${type}-${new Date().toISOString().split('T')[0]}.png`)
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
        date: type === 'workout' ? data.workout?.date : type === 'nutrition' ? data.nutrition?.date : data.health?.date || today,
        title,
        subtitle,
        data: data[type] || data,
        shared: true,
        timestamp: new Date().toISOString()
      }

      // Get existing shared items
      const existing = JSON.parse(localStorage.getItem('sharedToFeed') || '[]')
      existing.push(feedItem)
      
      // Keep only last 50 items
      const recent = existing.slice(-50)
      localStorage.setItem('sharedToFeed', JSON.stringify(recent))
      
      setSharedToFeed(true)
      alert('Shared to feed!')
      
      // Trigger a custom event to refresh the feed
      window.dispatchEvent(new CustomEvent('feedUpdated'))
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
              onClick={handleDownload}
              title="Download for Instagram Stories (download image, then upload to Instagram)"
            >
              <span className={styles.socialIcon}>IG</span>
            </button>
            <button 
              className={styles.socialBtn}
              onClick={() => openShareUrl(shareUrls.whatsapp)}
              title="Share on WhatsApp"
            >
              <span className={styles.socialIcon}>WA</span>
            </button>
          </div>
          <p className={styles.instagramNote}>
            For Instagram Stories: Download the image, then upload it to your Instagram Stories
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}

