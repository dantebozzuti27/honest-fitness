import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import ShareCard from './ShareCard'
import { generateShareImage, shareNative, copyImageToClipboard, downloadImage, getShareUrls, openShareUrl } from '../utils/shareUtils'
import styles from './ShareModal.module.css'

export default function ShareModal({ type, data, onClose }) {
  const [sharing, setSharing] = useState(false)
  const [imageDataUrl, setImageDataUrl] = useState(null)
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
      
      const shared = await shareNative(
        'Echelon',
        text,
        window.location.origin
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

