import { useRef, useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getUserProfile } from '../lib/friendsDb'
import { generateInviteLink, getInviteText } from '../lib/friendsDb'
import { shareNative } from '../utils/shareUtils'
import { useToast } from '../hooks/useToast'
import Toast from './Toast'
import { logError } from '../utils/logger'
import Button from './Button'
import Modal from './Modal'
import styles from './InviteFriends.module.css'

export default function InviteFriends({ onClose }) {
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [inviteText, setInviteText] = useState('')
  const [copied, setCopied] = useState(false)
  const modalRef = useRef(null)
  const closeBtnRef = useRef(null)

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
      logError('Error loading invite data', error)
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
      logError('Failed to copy invite link', error)
      showToast('Failed to copy link. Please try again.', 'error')
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
      logError('Error sharing invite', error)
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
    <Modal
      isOpen
      onClose={onClose}
      containerRef={modalRef}
      initialFocusRef={closeBtnRef}
      overlayClassName={styles.overlay}
      modalClassName={styles.modal}
      ariaLabel="Invite friends"
    >
        <div className={styles.header}>
          <h2>Invite Friends</h2>
          <Button
            ref={closeBtnRef}
            unstyled
            className={styles.closeBtn}
            onClick={() => {
              if (onClose && typeof onClose === 'function') {
                onClose()
              }
            }}
          >
            ×
          </Button>
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
              <Button
                unstyled
                className={styles.copyBtn}
                onClick={() => {
                  if (handleCopyLink && typeof handleCopyLink === 'function') {
                    handleCopyLink()
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className={styles.shareSection}>
            <label className={styles.label}>Share via Text</label>
            <div className={styles.shareButtons}>
              <Button
                unstyled
                className={styles.shareBtn}
                onClick={() => {
                  if (handleShareText && typeof handleShareText === 'function') {
                    handleShareText()
                  }
                }}
                disabled={loading}
              >
                {loading ? 'Opening...' : 'Share via Text'}
              </Button>
              <Button
                unstyled
                className={styles.shareBtn}
                onClick={() => {
                  if (handleShareSMS && typeof handleShareSMS === 'function') {
                    handleShareSMS()
                  }
                }}
              >
                Open SMS
              </Button>
            </div>
          </div>

          <div className={styles.preview}>
            <label className={styles.label}>Preview Message</label>
            <div className={styles.previewText}>
              {inviteText}
            </div>
          </div>
        </div>

        {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
    </Modal>
  )
}

