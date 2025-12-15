import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import ShareCard from './ShareCard'
import { generateShareImage, shareNative, copyImageToClipboard, downloadImage, getShareUrls, openShareUrl } from '../utils/shareUtils'
import { trackShareClick } from '../utils/shareAnalytics'
import { calculateWorkoutAchievements, calculateNutritionAchievements, calculateHealthAchievements } from '../utils/achievements'
import { useAuth } from '../context/AuthContext'
import { saveFeedItemToSupabase, getWorkoutsFromSupabase, calculateStreakFromSupabase } from '../lib/supabaseDb'
import { useToast } from '../hooks/useToast'
import Toast from './Toast'
import styles from './ShareModal.module.css'

export default function ShareModal({ type, data, onClose }) {
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [sharing, setSharing] = useState(false)
  const [imageDataUrl, setImageDataUrl] = useState(null)
  const [sharedToFeed, setSharedToFeed] = useState(false)
  const [theme, setTheme] = useState('default')
  const [template, setTemplate] = useState('standard')
  const [achievements, setAchievements] = useState([])
  const [userStats, setUserStats] = useState({})
  const cardRef = useRef(null)

  // Load user stats for achievements
  useEffect(() => {
    if (user) {
      Promise.all([
        getWorkoutsFromSupabase(user.id),
        calculateStreakFromSupabase(user.id)
      ]).then(([workouts, streak]) => {
        setUserStats({
          totalWorkouts: workouts?.length || 0,
          currentStreak: streak || 0,
          previousWorkout: workouts?.[1] || null
        })
      }).catch(() => {})
    }
  }, [user])

  // Calculate achievements
  useEffect(() => {
    let calculated = []
    if (type === 'workout' && data.workout) {
      calculated = calculateWorkoutAchievements(data.workout, userStats)
    } else if (type === 'nutrition' && data.nutrition) {
      calculated = calculateNutritionAchievements(data.nutrition, userStats)
    } else if (type === 'health' && data.health) {
      calculated = calculateHealthAchievements(data.health, userStats)
    }
    setAchievements(calculated)
  }, [type, data, userStats])

  useEffect(() => {
    // Generate image when modal opens or theme/template changes
    const generateImage = async () => {
      if (cardRef.current) {
        const imageUrl = await generateShareImage(cardRef.current, 'default')
        setImageDataUrl(imageUrl)
      }
    }
    
    // Small delay to ensure card is rendered
    const timeoutId = setTimeout(generateImage, 100)
    
    // Cleanup timeout on unmount
    return () => clearTimeout(timeoutId)
  }, [type, data, theme, template])

  const handleNativeShare = async (platform = 'native') => {
    setSharing(true)
    try {
      // Generate achievement-focused share text
      let text = 'Check out my progress on Echelon!'
      try {
        const achievementsModule = await import('../utils/achievements')
        const { generateAchievementShareText } = achievementsModule || {}
        if (generateAchievementShareText && typeof generateAchievementShareText === 'function') {
          text = generateAchievementShareText(type, data, achievements)
        }
      } catch (achievementsError) {
        // Fallback to default text if import fails
      }
      
      // Track share click
      trackShareClick(platform, type, { image: !!imageDataUrl, achievement: achievements.length > 0 })
      
      // Use the generated image if available
      const imageToShare = imageDataUrl || (cardRef.current ? await generateShareImage(cardRef.current, platform) : null)
      
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
        showToast('Unable to generate image', 'error')
        return
      }
      
      const copied = await copyImageToClipboard(imageToCopy)
      if (copied) {
        showToast('Image copied! You can paste it in Messages, Instagram, or any app.', 'success', 5000)
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
      showToast('Unable to copy image. Try using the Share button instead.', 'error')
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

  const handleShareToFeed = async () => {
    try {
      if (!user) {
        showToast('Please log in to share to feed', 'error')
        return
      }

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
        shared: true
      }

      // Save to database
      let saved = null
      try {
        saved = await saveFeedItemToSupabase(feedItem, user.id)
      } catch (dbError) {
        // Silently ignore PGRST205 errors (table doesn't exist)
        if (dbError.code !== 'PGRST205' && !dbError.message?.includes('Could not find the table')) {
          console.error('Error saving to database:', dbError)
        }
      }
      
      if (saved) {
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
        // Fallback to localStorage if database unavailable
        try {
          const existing = JSON.parse(localStorage.getItem('sharedToFeed') || '[]')
          const feedItemWithTimestamp = {
            ...feedItem,
            timestamp: new Date().toISOString()
          }
          existing.push(feedItemWithTimestamp)
          const recent = existing.slice(-50)
          localStorage.setItem('sharedToFeed', JSON.stringify(recent))
          setSharedToFeed(true)
          window.dispatchEvent(new CustomEvent('feedUpdated'))
        } catch (parseError) {
          console.error('Error parsing localStorage feed data', parseError)
          localStorage.removeItem('sharedToFeed')
          setSharedToFeed(false)
        }
      }
    } catch (error) {
      // Silently ignore PGRST205 errors (table doesn't exist)
      if (error.code !== 'PGRST205' && !error.message?.includes('Could not find the table')) {
        console.error('Error sharing to feed:', error)
        showToast('Failed to share to feed', 'error')
      } else {
        // Fallback to localStorage for PGRST205 errors (only if feedItem was defined)
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
          
          try {
            const existing = JSON.parse(localStorage.getItem('sharedToFeed') || '[]')
            existing.push(feedItem)
            const recent = existing.slice(-50)
            localStorage.setItem('sharedToFeed', JSON.stringify(recent))
            setSharedToFeed(true)
          } catch (parseError) {
            console.error('Error parsing localStorage feed data', parseError)
            localStorage.removeItem('sharedToFeed')
            setSharedToFeed(false)
          }
          window.dispatchEvent(new CustomEvent('feedUpdated'))
        } catch (fallbackError) {
          console.error('Error in fallback to localStorage:', fallbackError)
        }
      }
    }
  }

  const shareUrls = getShareUrls(type, data, achievements)
  
  // Share templates
  const templates = {
    standard: { theme: 'default', showAchievements: true, showBranding: true, showSocial: true },
    achievement: { theme: 'default', showAchievements: true, showBranding: true, showSocial: false },
    minimal: { theme: 'minimal', showAchievements: false, showBranding: false, showSocial: false },
    social: { theme: 'default', showAchievements: true, showBranding: true, showSocial: true }
  }
  
  const currentTemplate = templates[template] || templates.standard

  return createPortal(
    <div 
      className={styles.overlay} 
      onClick={() => {
        if (onClose && typeof onClose === 'function') {
          onClose()
        }
      }}
    >
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Share Your {type === 'workout' ? 'Workout' : type === 'nutrition' ? 'Nutrition' : 'Health'} Summary</h2>
          <button 
            className={styles.closeBtn} 
            onClick={() => {
              if (onClose && typeof onClose === 'function') {
                onClose()
              }
            }}
          >
            ✕
          </button>
        </div>
        
        {/* Customization Options */}
        <div className={styles.customizationSection}>
          <div className={styles.customizationGroup}>
            <label className={styles.customizationLabel}>Theme</label>
            <select 
              className={styles.customizationSelect}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="default">Default</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="gradient">Gradient</option>
              <option value="minimal">Minimal</option>
            </select>
          </div>
          <div className={styles.customizationGroup}>
            <label className={styles.customizationLabel}>Template</label>
            <select 
              className={styles.customizationSelect}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="achievement">Achievement Focus</option>
              <option value="minimal">Minimal</option>
              <option value="social">Social</option>
            </select>
          </div>
        </div>

        <div className={styles.cardPreview}>
          <div ref={cardRef}>
            <ShareCard 
              type={type} 
              data={data}
              theme={currentTemplate.theme}
              showAchievements={currentTemplate.showAchievements}
              showBranding={currentTemplate.showBranding}
              showSocial={currentTemplate.showSocial}
            />
          </div>
        </div>

        <div className={styles.shareOptions}>
          {/* Native Share (Mobile) */}
          {navigator.share && (
            <button 
              className={styles.shareBtn}
              onClick={() => {
                if (handleNativeShare && typeof handleNativeShare === 'function') {
                  handleNativeShare()
                }
              }}
              disabled={sharing}
            >
              Share
            </button>
          )}

          {/* Copy Image */}
          <button 
            className={styles.shareBtn}
            onClick={() => {
              if (handleCopyImage && typeof handleCopyImage === 'function') {
                handleCopyImage()
              }
            }}
          >
            Copy Image
          </button>

          {/* Download */}
          <button 
            className={styles.shareBtn}
            onClick={() => {
              if (handleDownload && typeof handleDownload === 'function') {
                handleDownload()
              }
            }}
          >
            Download
          </button>

          {/* Share to Feed */}
          <button 
            className={`${styles.shareBtn} ${sharedToFeed ? styles.sharedToFeed : ''}`}
            onClick={() => {
              if (handleShareToFeed && typeof handleShareToFeed === 'function') {
                handleShareToFeed()
              }
            }}
            disabled={sharedToFeed}
          >
            {sharedToFeed ? '✓ Shared to Feed' : 'Share to Feed'}
          </button>

          {/* Social Platforms */}
          <div className={styles.socialGrid}>
            <button 
              className={styles.socialBtn}
              onClick={() => {
                trackShareClick('twitter', type, { image: !!imageDataUrl, achievement: achievements.length > 0 })
                openShareUrl(shareUrls.twitter)
              }}
              title="Share on X (Twitter)"
            >
              <span className={styles.socialIcon}>X</span>
            </button>
            <button 
              className={styles.socialBtn}
              onClick={() => {
                trackShareClick('facebook', type, { image: !!imageDataUrl, achievement: achievements.length > 0 })
                openShareUrl(shareUrls.facebook)
              }}
              title="Share on Facebook"
            >
              <span className={styles.socialIcon}>f</span>
            </button>
            <button 
              className={styles.socialBtn}
              onClick={async () => {
                trackShareClick('instagram', type, { image: true, achievement: achievements.length > 0 })
                // For Instagram, use native share with image (optimized for 1080x1080)
                const imageToShare = imageDataUrl || (cardRef.current ? await generateShareImage(cardRef.current, 'instagram') : null)
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
                trackShareClick('imessage', type, { image: !!imageDataUrl, achievement: achievements.length > 0 })
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
              <span className={styles.socialIcon}>Msg</span>
            </button>
          </div>
          <p className={styles.instagramNote}>
            Tap Copy Image to paste in any app, or use Share to open the native share sheet
          </p>
        </div>

        {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
      </div>
    </div>,
    document.body
  )
}

