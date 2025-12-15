import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getUserProfile, sendFriendRequest, getFriendshipStatus } from '../lib/friendsDb'
import HomeButton from '../components/HomeButton'
import styles from './Invite.module.css'

export default function Invite() {
  const { identifier } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [friendshipStatus, setFriendshipStatus] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!user) {
      // Redirect to auth if not logged in
      navigate('/auth')
      return
    }

    if (identifier) {
      loadProfile()
    }
  }, [identifier, user, navigate])

  const loadProfile = async () => {
    if (!user || !identifier) return
    
    setLoading(true)
    setError(null)
    
    try {
      const profileData = await getUserProfile(identifier)
      
      if (!profileData) {
        setError('User not found')
        setLoading(false)
        return
      }

      // Don't allow adding yourself
      if (profileData.user_id === user.id) {
        setError('You cannot add yourself as a friend')
        setLoading(false)
        return
      }

      setProfile(profileData)

      // Check existing friendship status
      const status = await getFriendshipStatus(user.id, profileData.user_id)
      setFriendshipStatus(status)
    } catch (err) {
      console.error('Error loading profile:', err)
      setError('Failed to load profile. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSendRequest = async () => {
    if (!user || !profile) return

    setSending(true)
    setError(null)

    try {
      await sendFriendRequest(user.id, profile.user_id)
      setSuccess(true)
      // Reload friendship status
      const status = await getFriendshipStatus(user.id, profile.user_id)
      setFriendshipStatus(status)
    } catch (err) {
      console.error('Error sending friend request:', err)
      setError(err.message || 'Failed to send friend request. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate('/')}>
            ← Back
          </button>
          <h1>Add Friend</h1>
          <HomeButton />
        </div>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  if (error && !profile) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate('/')}>
            ← Back
          </button>
          <h1>Add Friend</h1>
          <HomeButton />
        </div>
        <div className={styles.error}>
          <p>{error}</p>
          <button className={styles.actionBtn} onClick={() => navigate('/')}>
            Go Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1>Add Friend</h1>
        <HomeButton />
      </div>

      <div className={styles.content}>
        {profile && (
          <div className={styles.profileCard}>
            <div className={styles.profilePictureSection}>
              {profile.profile_picture ? (
                <img
                  src={profile.profile_picture}
                  alt={profile.display_name || profile.username}
                  className={styles.profilePicture}
                />
              ) : (
                <div className={styles.profilePicturePlaceholder}>
                  {(profile.display_name || profile.username || 'U')[0].toUpperCase()}
                </div>
              )}
            </div>

            <h2 className={styles.name}>
              {profile.display_name || profile.username || 'User'}
            </h2>

            {profile.username && (
              <p className={styles.username}>@{profile.username}</p>
            )}

            {profile.bio && (
              <p className={styles.bio}>{profile.bio}</p>
            )}

            {success && (
              <div className={styles.successMessage}>
                ✓ Friend request sent!
              </div>
            )}

            {error && (
              <div className={styles.errorMessage}>
                {error}
              </div>
            )}

            <div className={styles.actions}>
              {friendshipStatus?.status === 'accepted' ? (
                <div className={styles.statusMessage}>
                  ✓ You are already friends
                </div>
              ) : friendshipStatus?.status === 'pending' ? (
                <div className={styles.statusMessage}>
                  {friendshipStatus.requestedBy === 'me' 
                    ? '⏳ Friend request pending'
                    : '📬 You have a pending request from this user'}
                </div>
              ) : (
                <button
                  className={styles.addBtn}
                  onClick={() => {
                    if (handleSendRequest && typeof handleSendRequest === 'function') {
                      handleSendRequest()
                    }
                  }}
                  disabled={sending}
                >
                  {sending ? 'Sending...' : 'Send Friend Request'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

