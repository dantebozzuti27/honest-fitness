import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getUserProfile } from '../lib/friendsDb'
import { generateInviteLink, getInviteText } from '../lib/friendsDb'
import { shareNative } from '../utils/shareUtils'
import styles from './InviteFriends.module.css'

export default function InviteFriends({ onClose }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [inviteText, setInviteText] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (user) {
      loadInviteData()
    }
  }, [user])

  const loadInviteData = async () => {
    if (!user) return
    
    try {
      const profile = await getUserProfile(user.id)
      if (profile) {
        const link = generateInviteLink(profile.user_id, profile.username)
        const text = getInviteText(profile.display_name, profile.username)
        setInviteLink(link)
        setInviteText(text)
      } else {
        // Fallback to userId if profile doesn't exist
        const link = generateInviteLink(user.id, null)
        const text = `Join me on Echelon Fitness! Add me as a friend: ${link}`
        setInviteLink(link)
        setInviteText(text)
      }
    } catch (error) {
      console.error('Error loading invite data:', error)
      // Fallback to userId if profile fails
      const link = generateInviteLink(user.id, null)
      const text = `Join me on Echelon Fitness! Add me as a friend: ${link}`
      setInviteLink(link)
      setInviteText(text)
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
      alert('Failed to copy link. Please try again.')
    }
  }

  const handleShareText = async () => {
    setLoading(true)
    try {
      // Use native share API if available (works on mobile)
      const shared = await shareNative(
        'Invite to Echelon Fitness',
        inviteText,
        inviteLink
      )
      
      if (!shared) {
        // Fallback: open SMS app with pre-filled text
        const smsUrl = `sms:?body=${encodeURIComponent(inviteText)}`
        window.location.href = smsUrl
      }
    } catch (error) {
      console.error('Error sharing:', error)
      // Fallback: open SMS app
      const smsUrl = `sms:?body=${encodeURIComponent(inviteText)}`
      window.location.href = smsUrl
    } finally {
      setLoading(false)
    }
  }

  const handleShareSMS = () => {
    const smsUrl = `sms:?body=${encodeURIComponent(inviteText)}`
    window.location.href = smsUrl
  }

  if (!inviteLink) {
    loadInviteData()
    return <div className={styles.loading}>Loading...</div>
  }

  return (
    <div 
      className={styles.overlay} 
      onClick={() => {
        if (onClose && typeof onClose === 'function') {
          onClose()
        }
      }}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Invite Friends</h2>
          <button 
            className={styles.closeBtn} 
            onClick={() => {
              if (onClose && typeof onClose === 'function') {
                onClose()
              }
            }}
          >
            ×
          </button>
        </div>
        
        <div className={styles.content}>
          <p className={styles.description}>
            Share your profile link with friends so they can add you on Echelon Fitness!
          </p>
          
          <div className={styles.linkSection}>
            <label className={styles.label}>Your Invite Link</label>
            <div className={styles.linkContainer}>
              <input
                type="text"
                value={inviteLink}
                readOnly
                className={styles.linkInput}
              />
              <button
                className={styles.copyBtn}
                onClick={() => {
                  if (handleCopyLink && typeof handleCopyLink === 'function') {
                    handleCopyLink()
                  }
                }}
              >
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className={styles.shareSection}>
            <label className={styles.label}>Share via Text</label>
            <div className={styles.shareButtons}>
              <button
                className={styles.shareBtn}
                onClick={() => {
                  if (handleShareText && typeof handleShareText === 'function') {
                    handleShareText()
                  }
                }}
                disabled={loading}
              >
                {loading ? 'Opening...' : '📱 Share via Text'}
              </button>
              <button
                className={styles.shareBtn}
                onClick={() => {
                  if (handleShareSMS && typeof handleShareSMS === 'function') {
                    handleShareSMS()
                  }
                }}
              >
                📲 Open SMS
              </button>
            </div>
          </div>

          <div className={styles.preview}>
            <label className={styles.label}>Preview Message</label>
            <div className={styles.previewText}>
              {inviteText}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

