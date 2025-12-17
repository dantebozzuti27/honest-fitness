import { useRef, useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { searchUsers, sendFriendRequest, getFriendshipStatus, getUserProfile } from '../lib/friendsDb'
import { useToast } from '../hooks/useToast'
import { logError } from '../utils/logger'
import Button from './Button'
import Modal from './Modal'
import styles from './AddFriend.module.css'

export default function AddFriend({ onClose, onFriendAdded, initialSearchTerm = '' }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [friendStatuses, setFriendStatuses] = useState({})
  const modalRef = useRef(null)
  const closeBtnRef = useRef(null)

  useEffect(() => {
    if (typeof initialSearchTerm === 'string' && initialSearchTerm.trim()) {
      setSearchTerm(initialSearchTerm.trim())
    }
  }, [initialSearchTerm])

  useEffect(() => {
    if (searchTerm.length >= 2) {
      const timeoutId = setTimeout(() => {
        performSearch()
      }, 300) // Debounce search

      return () => clearTimeout(timeoutId)
    } else {
      setSearchResults([])
    }
  }, [searchTerm])

  const performSearch = async () => {
    if (!user || searchTerm.length < 2) return
    
    setSearching(true)
    try {
      const results = await searchUsers(searchTerm, user.id)
      setSearchResults(results)
      
      // Get friendship status for each result
      const statuses = {}
      for (const result of results) {
        const status = await getFriendshipStatus(user.id, result.user_id)
        statuses[result.user_id] = status
      }
      setFriendStatuses(statuses)
    } catch (error) {
      logError('Error searching users', error)
      showToast('Error searching users', 'error')
    } finally {
      setSearching(false)
    }
  }

  const handleAddFriend = async (friendId) => {
    if (!user) return
    
    try {
      await sendFriendRequest(user.id, friendId)
      showToast('Friend request sent!', 'success')
      
      // Update status
      setFriendStatuses(prev => ({
        ...prev,
        [friendId]: { status: 'pending', requestedBy: 'me' }
      }))
      
      if (onFriendAdded) {
        onFriendAdded()
      }
    } catch (error) {
      logError('Error sending friend request', error)
      showToast(error.message || 'Error sending friend request', 'error')
    }
  }

  const handleSearchByUsername = async () => {
    if (!user || !searchTerm.trim()) return
    
    setSearching(true)
    try {
      // Try to find user by username
      const profile = await getUserProfile(searchTerm.trim())
      if (profile) {
        if (profile.user_id === user.id) {
          showToast('Cannot add yourself as a friend', 'error')
          return
        }
        
        setSearchResults([profile])
        const status = await getFriendshipStatus(user.id, profile.user_id)
        setFriendStatuses({ [profile.user_id]: status })
      } else {
        showToast('User not found', 'error')
        setSearchResults([])
      }
    } catch (error) {
      logError('Error searching by username', error)
      showToast('Error searching user', 'error')
    } finally {
      setSearching(false)
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
      ariaLabel="Add friend"
    >
        <div className={styles.header}>
          <h2>Add Friend</h2>
          <Button
            ref={closeBtnRef}
            unstyled
            className={styles.closeBtn}
            onClick={() => {
              if (onClose && typeof onClose === 'function') {
                onClose()
              }
            }}
            aria-label="Close"
          >
            ×
          </Button>
        </div>
        
        <div className={styles.searchSection}>
          <div className={styles.searchInputContainer}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by username or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearchByUsername()
                }
              }}
            />
            <Button unstyled className={styles.searchBtn} onClick={handleSearchByUsername} disabled={searching || !searchTerm.trim()}>
              Search
            </Button>
          </div>
        </div>

        {searching && (
          <div className={styles.loading}>Searching...</div>
        )}

        {searchResults.length > 0 && (
          <div className={styles.results}>
            {searchResults.map((user) => {
              const status = friendStatuses[user.user_id]
              const isFriend = status?.status === 'accepted'
              const isPending = status?.status === 'pending'
              const isBlocked = status?.status === 'blocked'
              
              return (
                <div key={user.user_id} className={styles.userCard}>
                  <div className={styles.userInfo}>
                    {user.profile_picture ? (
                      <img 
                        src={user.profile_picture} 
                        alt={user.display_name || user.username || 'User'} 
                        className={styles.avatar}
                      />
                    ) : (
                      <div className={styles.avatarPlaceholder}>
                        {(user.display_name || user.username || 'U')[0].toUpperCase()}
                      </div>
                    )}
                    <div className={styles.userDetails}>
                      <div className={styles.userName}>
                        {user.display_name || user.username || 'User'}
                      </div>
                      {user.username && (
                        <div className={styles.userUsername}>@{user.username}</div>
                      )}
                      {user.bio && (
                        <div className={styles.userBio}>{user.bio}</div>
                      )}
                    </div>
                  </div>
                  <div className={styles.userActions}>
                    {isFriend ? (
                      <span className={styles.friendStatus}>Friends</span>
                    ) : isPending ? (
                      <span className={styles.pendingStatus}>
                        {status.requestedBy === 'me' ? 'Request Sent' : 'Pending'}
                      </span>
                    ) : isBlocked ? (
                      <span className={styles.blockedStatus}>Blocked</span>
                    ) : (
                      <Button unstyled className={styles.addBtn} onClick={() => handleAddFriend(user.user_id)}>
                        Add Friend
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {searchTerm.length >= 2 && !searching && searchResults.length === 0 && (
          <div className={styles.noResults}>No users found</div>
        )}
    </Modal>
  )
}

