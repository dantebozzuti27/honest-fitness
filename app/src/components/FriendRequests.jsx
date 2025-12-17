import { useRef, useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getPendingFriendRequests, acceptFriendRequest, declineFriendRequest } from '../lib/friendsDb'
import { logError } from '../utils/logger'
import { useToast } from '../hooks/useToast'
import Toast from './Toast'
import Modal from './Modal'
import styles from './FriendRequests.module.css'

export default function FriendRequests({ onClose, onRequestHandled }) {
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [handling, setHandling] = useState(null)
  const modalRef = useRef(null)
  const closeBtnRef = useRef(null)

  useEffect(() => {
    if (user) {
      loadRequests()
    }
  }, [user])

  const loadRequests = async () => {
    if (!user) return
    setLoading(true)
    try {
      const pending = await getPendingFriendRequests(user.id)
      setRequests(pending || [])
    } catch (error) {
      logError('Error loading friend requests', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async (requestUserId) => {
    if (!user || handling) return
    setHandling(requestUserId)
    try {
      await acceptFriendRequest(user.id, requestUserId)
      await loadRequests()
      if (onRequestHandled) {
        onRequestHandled()
      }
      // Trigger feed update
      window.dispatchEvent(new CustomEvent('feedUpdated'))
    } catch (error) {
      logError('Error accepting friend request', error)
      showToast('Failed to accept friend request. Please try again.', 'error')
    } finally {
      setHandling(null)
    }
  }

  const handleDecline = async (requestUserId) => {
    if (!user || handling) return
    setHandling(requestUserId)
    try {
      await declineFriendRequest(user.id, requestUserId)
      await loadRequests()
      if (onRequestHandled) {
        onRequestHandled()
      }
    } catch (error) {
      logError('Error declining friend request', error)
      showToast('Failed to decline friend request. Please try again.', 'error')
    } finally {
      setHandling(null)
    }
  }

  const getUserInfo = (request) => {
    const profile = request.user_profiles || {}
    return {
      userId: request.user_id,
      username: profile.username || 'User',
      displayName: profile.display_name || profile.username || 'User',
      profilePicture: profile.profile_picture || null
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      containerRef={modalRef}
      initialFocusRef={closeBtnRef}
      overlayClassName={styles.overlay}
      modalClassName={styles.modal}
      ariaLabel="Friend requests"
    >
        <div className={styles.header}>
          <h2 className={styles.title}>Friend Requests</h2>
          <button 
            ref={closeBtnRef}
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
          {loading ? (
            <div className={styles.loading}>Loading...</div>
          ) : requests.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>No pending friend requests</p>
            </div>
          ) : (
            <div className={styles.requestsList}>
              {requests.map((request) => {
                const userInfo = getUserInfo(request)
                return (
                  <div key={request.user_id} className={styles.requestItem}>
                    <div className={styles.userInfo}>
                      {userInfo.profilePicture ? (
                        <img 
                          src={userInfo.profilePicture} 
                          alt={userInfo.displayName}
                          className={styles.avatar}
                        />
                      ) : (
                        <div className={styles.avatarPlaceholder}>
                          {userInfo.displayName[0].toUpperCase()}
                        </div>
                      )}
                      <div className={styles.userDetails}>
                        <div className={styles.userName}>{userInfo.displayName}</div>
                        {userInfo.username && (
                          <div className={styles.userUsername}>@{userInfo.username}</div>
                        )}
                      </div>
                    </div>
                    <div className={styles.actions}>
                      <button
                        className={styles.acceptBtn}
                        onClick={() => handleAccept(userInfo.userId)}
                        disabled={handling === userInfo.userId}
                      >
                        {handling === userInfo.userId ? '...' : 'Accept'}
                      </button>
                      <button
                        className={styles.declineBtn}
                        onClick={() => handleDecline(userInfo.userId)}
                        disabled={handling === userInfo.userId}
                      >
                        {handling === userInfo.userId ? '...' : 'Decline'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
    </Modal>
  )
}

