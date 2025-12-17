import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { exportWorkoutData } from '../utils/exportData'
import { exportUserDataJSON, exportWorkoutsCSV, exportHealthMetricsCSV, downloadData } from '../lib/dataExport'
import { getAllConnectedAccounts, disconnectAccount } from '../lib/wearables'
import { getDefaultVisibilityPreference, setDefaultVisibilityPreference, getUserPreferences, saveUserPreferences } from '../lib/db/userPreferencesDb'
import { getUserEventStats } from '../lib/db/userEventsDb'
import { getUserProfile, updateUserProfile, getOrCreateUserProfile, getFriends, getFriendCount, getPendingFriendRequests } from '../lib/friendsDb'
import { deleteUserAccount } from '../lib/accountDeletion'
import { supabase } from '../lib/supabase'
import { getTodayEST } from '../utils/dateUtils'
import HomeButton from '../components/HomeButton'
import InviteFriends from '../components/InviteFriends'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import BackButton from '../components/BackButton'
import Skeleton from '../components/Skeleton'
import InputField from '../components/InputField'
import TextAreaField from '../components/TextAreaField'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { logError } from '../utils/logger'
import { SUPPORT_PATH, PRIVACY_PATH, TERMS_PATH } from '../config/appStore'
import styles from './Profile.module.css'

export default function Profile() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [exporting, setExporting] = useState(false)
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [profilePicture, setProfilePicture] = useState(null)
  const [profilePictureUrl, setProfilePictureUrl] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [friends, setFriends] = useState([])
  const [friendCount, setFriendCount] = useState(0)
  const [pendingRequests, setPendingRequests] = useState(0)
  const [loadingSocial, setLoadingSocial] = useState(true)
  const [showInviteFriends, setShowInviteFriends] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const editModalRef = useRef(null)
  const editModalCloseBtnRef = useRef(null)
  const [defaultVisibility, setDefaultVisibility] = useState('public')
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [disconnectConfirm, setDisconnectConfirm] = useState({ open: false, provider: null })
  const [finalDeleteConfirmOpen, setFinalDeleteConfirmOpen] = useState(false)
  const [userEventStats, setUserEventStats] = useState(null)
  const shownErrorsRef = useRef({ profile: false, social: false, connected: false })

  useEffect(() => {
    if (user) {
      loadConnectedAccounts()
      loadProfile()
      loadSocialData()
      loadUserEventStats()
    } else {
      setUserEventStats(null)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    getDefaultVisibilityPreference(user.id).then(v => {
      setDefaultVisibility(v || 'public')
    }).catch(() => {})
  }, [user])

  const loadProfile = async () => {
    if (!user) return
    try {
      // Load user profile (username, phone, etc.)
      let profile = await getUserProfile(user.id)
      if (!profile) {
        // Create profile if it doesn't exist
        profile = await getOrCreateUserProfile(user.id, {
          username: user.email?.split('@')[0] || `user_${user.id.slice(0, 8)}`,
          phone_number: ''
        })
      }
      
      if (profile) {
        setUsername(profile.username || '')
        setPhoneNumber(profile.phone_number || '')
        setDisplayName(profile.display_name || '')
        setBio(profile.bio || '')
        setProfilePictureUrl(profile.profile_picture || null)
      }
      
      // Also load preferences for other settings
      const prefs = await getUserPreferences(user.id)
      if (prefs && !profile?.profile_picture) {
        setProfilePictureUrl(prefs.profile_picture || null)
      }
    } catch (error) {
      logError('Profile load error', error)
      if (!shownErrorsRef.current.profile) {
        shownErrorsRef.current.profile = true
        showToast('Failed to load profile. Please refresh and try again.', 'error')
      }
    }
  }

  const handleProfilePictureChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    
    try {
      // Prefer Storage bucket if available (scales better than base64-in-DB).
      // Fallback to base64 if the bucket/policies aren't configured yet.
      if (supabase?.storage) {
        try {
          const ext = (file.name || '').split('.').pop() || 'png'
          const path = `${user.id}/${Date.now()}.${ext}`
          const upload = await supabase.storage.from('avatars').upload(path, file, {
            upsert: true,
            contentType: file.type || 'image/*'
          })
          if (!upload.error) {
            const pub = supabase.storage.from('avatars').getPublicUrl(path)
            const url = pub?.data?.publicUrl
            if (url) {
              setProfilePictureUrl(url)
              setProfilePicture(url)
              showToast('Profile photo uploaded.', 'success', 1200)
              return
            }
          }
        } catch (storageErr) {
          // Fall back to base64 below.
          logError('Profile picture storage upload failed; falling back to base64', storageErr)
        }
      }

      // Fallback: Convert to base64 (simpler but less scalable)
      const reader = new FileReader()
      reader.onloadend = async () => {
        try {
          const base64String = reader.result
          setProfilePictureUrl(base64String)
          setProfilePicture(base64String)
        } catch (error) {
          logError('Profile picture read error', error)
          showToast('Failed to read image file. Please try again.', 'error')
        }
      }
      reader.onerror = () => {
        showToast('Failed to read image file. Please try again.', 'error')
      }
      reader.readAsDataURL(file)
    } catch (error) {
      logError('Profile picture upload error', error)
      showToast(`Failed to upload profile picture: ${error.message || 'Please try again.'}`, 'error')
    }
  }

  const handleSaveProfile = async () => {
    if (!user) return
    
    // Validate required fields
    if (!username.trim()) {
      showToast('Username is required', 'error')
      return
    }
    
    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/
    if (!usernameRegex.test(username.trim())) {
      showToast('Username must be 3-20 characters and contain only letters, numbers, underscores, or hyphens', 'error', 6000)
      return
    }
    
    // Validate phone number (optional)
    if (phoneNumber.trim()) {
      const digitsOnly = phoneNumber.replace(/\D/g, '')
      if (digitsOnly.length < 10) {
        showToast('Please enter a valid phone number', 'error')
        return
      }
    }
    
    setSaving(true)
    try {
      // Update user profile (username, phone, display_name, bio, profile_picture)
      await updateUserProfile(user.id, {
        username: username.trim().toLowerCase(),
        phone_number: phoneNumber.trim() || null,
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        profile_picture: profilePicture || profilePictureUrl || null
      })
      
      // Also save profile picture to preferences for backward compatibility
      const prefs = await getUserPreferences(user.id) || {}
      await saveUserPreferences(user.id, {
        ...prefs,
        profilePicture: profilePicture || profilePictureUrl || null
      })
      
      showToast('Profile updated successfully!', 'success')
    } catch (error) {
      logError('Profile save error', error)
      showToast(`Failed to update profile: ${error.message || 'Please try again.'}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const loadSocialData = async () => {
    if (!user) return
    setLoadingSocial(true)
    try {
      const [friendsList, count, pending] = await Promise.all([
        getFriends(user.id),
        getFriendCount(user.id),
        getPendingFriendRequests(user.id)
      ])
      setFriends(friendsList || [])
      setFriendCount(count || 0)
      setPendingRequests(pending?.length || 0)
    } catch (error) {
      logError('Social data load error', error)
      if (!shownErrorsRef.current.social) {
        shownErrorsRef.current.social = true
        showToast('Failed to load social data. Please try again.', 'error')
      }
    } finally {
      setLoadingSocial(false)
    }
  }

  const loadUserEventStats = async () => {
    if (!user) return
    try {
      const stats = await getUserEventStats(user.id, 30)
      // Defensive normalization so rendering never crashes.
      setUserEventStats({
        totalEvents: Number(stats?.totalEvents || 0),
        sessions: Number(stats?.sessions || 0),
        mostUsedFeatures: Array.isArray(stats?.mostUsedFeatures) ? stats.mostUsedFeatures : [],
        dailyActivity: stats?.dailyActivity && typeof stats.dailyActivity === 'object' ? stats.dailyActivity : {}
      })
    } catch (e) {
      logError('Error loading user event stats', e)
      setUserEventStats(null)
    }
  }

  const loadConnectedAccounts = async () => {
    if (!user) return
    try {
      const accounts = await getAllConnectedAccounts(user.id)
      setConnectedAccounts(accounts || [])
    } catch (error) {
      logError('Connected accounts load error', error)
      if (!shownErrorsRef.current.connected) {
        shownErrorsRef.current.connected = true
        showToast('Failed to load connected accounts. Please try again.', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async (provider) => {
    if (!user) return
    setDisconnectConfirm({ open: true, provider })
  }

  const confirmDisconnect = async () => {
    if (!user || !disconnectConfirm.provider) {
      setDisconnectConfirm({ open: false, provider: null })
      return
    }

    const provider = disconnectConfirm.provider
    try {
      await disconnectAccount(user.id, provider)
      await loadConnectedAccounts()
      showToast(`${provider} disconnected successfully`, 'success')
    } catch (error) {
      showToast(`Failed to disconnect ${provider}. Please try again.`, 'error')
    } finally {
      setDisconnectConfirm({ open: false, provider: null })
    }
  }

  const handleExport = async (format = 'json') => {
    if (!user) return
    setExporting(true)
    try {
      if (format === 'json') {
        const data = await exportUserDataJSON(user.id)
        downloadData(data, `honest-fitness-data-${getTodayEST()}.json`, 'application/json')
        showToast('All data exported as JSON!', 'success')
      } else if (format === 'workouts-csv') {
        const csv = await exportWorkoutsCSV(user.id)
        downloadData(csv, `workouts-${getTodayEST()}.csv`, 'text/csv')
        showToast('Workouts exported as CSV!', 'success')
      } else if (format === 'metrics-csv') {
        const csv = await exportHealthMetricsCSV(user.id)
        downloadData(csv, `health-metrics-${getTodayEST()}.csv`, 'text/csv')
        showToast('Health metrics exported as CSV!', 'success')
      } else if (format === 'excel') {
        // Legacy Excel export
        const result = await exportWorkoutData(user.id, user.email)
        showToast(`Exported ${result.workouts} workouts and ${result.metrics} daily metrics. The Excel file has been downloaded.`, 'success', 7000)
      }
      setShowExportMenu(false)
    } catch (err) {
      logError('Export error', err)
      showToast('Failed to export data. Please try again.', 'error')
    }
    setExporting(false)
  }



  const handleLogout = async () => {
    await signOut()
    navigate('/auth')
  }

  const handleDeleteAccount = async () => {
    if (!user) return

    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true)
      return
    }

    if (deleteConfirmText !== 'DELETE') {
      showToast('Please type "DELETE" to confirm account deletion', 'error')
      return
    }

    setFinalDeleteConfirmOpen(true)
  }

  const performDeleteAccount = async () => {
    if (!user) return

    setDeleting(true)
    try {
      await deleteUserAccount(user.id)
      
      // Sign out and redirect
      await signOut()
      showToast('Your account and all data have been permanently deleted.', 'success', 6000)
      navigate('/auth')
    } catch (error) {
      logError('Account deletion error', error)
      showToast(`Failed to delete account: ${error.message || 'Please try again or contact support.'}`, 'error', 7000)
      setDeleting(false)
      setShowDeleteConfirm(false)
      setDeleteConfirmText('')
      setFinalDeleteConfirmOpen(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <BackButton fallbackPath="/" />
        <h1>Profile</h1>
        <HomeButton />
      </div>

      <div className={styles.content}>
        {user && (
          <>
            {/* Profile Header - Social Media Style */}
            <div className={styles.profileHeader}>
              <div className={styles.profilePictureSection}>
                <div className={styles.profilePictureContainer}>
                  {profilePictureUrl ? (
                    <img src={profilePictureUrl} alt="Profile" className={styles.profilePicture} />
                  ) : (
                    <div className={styles.profilePicturePlaceholder}>
                      {username ? username.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <label className={styles.uploadBtnOverlay}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleProfilePictureChange}
                      style={{ display: 'none' }}
                    />
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </label>
                </div>
              </div>
              
              <div className={styles.profileStats}>
                <div className={styles.statItem}>
                  <div className={styles.statValue}>{friendCount}</div>
                  <div className={styles.statLabel}>Friends</div>
                </div>
                {pendingRequests > 0 && (
                  <div className={styles.statItem}>
                    <div className={styles.statValue}>{pendingRequests}</div>
                    <div className={styles.statLabel}>Requests</div>
                  </div>
                )}
              </div>
            </div>

            {/* Profile Info */}
            <div className={styles.profileInfo}>
              <div className={styles.profileNames}>
                <h2 className={styles.displayName}>{displayName || username || 'User'}</h2>
                <p className={styles.username}>@{username || 'username'}</p>
              </div>
              
              {bio && (
                <p className={styles.bio}>{bio}</p>
              )}
              
              <p className={styles.userEmail}>{user.email}</p>
            </div>

            {/* Edit Profile Button */}
            <button
              className={styles.editProfileBtn}
              onClick={() => setShowEditModal(true)}
            >
              Edit Profile
            </button>

            <div className={styles.quickLinksRow}>
              <button
                className={styles.quickLinkBtn}
                onClick={() => navigate('/market')}
                type="button"
              >
                Marketplace
              </button>
              <button
                className={styles.quickLinkBtn}
                onClick={() => navigate('/library')}
                type="button"
              >
                Library
              </button>
              <button
                className={styles.quickLinkBtn}
                onClick={() => navigate('/coach-studio')}
                type="button"
              >
                Coach Studio
              </button>
            </div>

            {/* Edit Modal */}
            {showEditModal && (
              <Modal
                isOpen={Boolean(showEditModal)}
                onClose={() => setShowEditModal(false)}
                containerRef={editModalRef}
                initialFocusRef={editModalCloseBtnRef}
                overlayClassName={styles.editModalOverlay}
                modalClassName={styles.editModal}
                ariaLabel="Edit profile"
              >
                  <div className={styles.editModalHeader}>
                    <h3>Edit Profile</h3>
                    <button ref={editModalCloseBtnRef} className={styles.closeBtn} onClick={() => setShowEditModal(false)}>×</button>
                  </div>
                  
                  <div className={styles.profileForm}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>Username *</label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="username"
                        className={styles.input}
                        minLength={3}
                        maxLength={20}
                        pattern="[a-zA-Z0-9_-]+"
                        required
                      />
                      <small className={styles.helperText}>3-20 characters, letters, numbers, _, or -</small>
                    </div>

                    <div className={styles.formGroup}>
                      <InputField
                        label="Phone Number"
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+1 (555) 123-4567"
                        className={styles.input}
                      />
                      <small className={styles.helperText}>Optional</small>
                    </div>

                    <div className={styles.formGroup}>
                      <InputField
                        label="Display Name"
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your display name"
                        className={styles.input}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <TextAreaField
                        label="Bio"
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="Tell us about yourself..."
                        className={styles.textarea}
                        rows={3}
                        maxLength={500}
                      />
                    </div>

                    <Button
                      unstyled
                      className={styles.saveBtn}
                      onClick={async () => {
                        await handleSaveProfile()
                        setShowEditModal(false)
                      }}
                      disabled={saving}
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
              </Modal>
            )}
          </>
        )}

        {/* Social Section */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Social</h2>
          {loadingSocial ? (
            <div className={styles.loading} style={{ width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Skeleton style={{ width: '50%', height: 16 }} />
                <Skeleton style={{ width: '100%', height: 120 }} />
              </div>
            </div>
          ) : (
            <>
              <div className={styles.socialStats}>
                <div className={styles.statItem}>
                  <div className={styles.statValue}>{friendCount}</div>
                  <div className={styles.statLabel}>Friends</div>
                </div>
                {pendingRequests > 0 && (
                  <div className={styles.statItem}>
                    <div className={styles.statValue}>{pendingRequests}</div>
                    <div className={styles.statLabel}>Pending Requests</div>
                  </div>
                )}
              </div>
              
              {friends.length > 0 && (
                <div className={styles.friendsList}>
                  <h3 className={styles.friendsTitle}>Friends</h3>
                  <div className={styles.friendsGrid}>
                    {friends.slice(0, 12).map((friend) => (
                      <div key={friend.user_id || friend.friend_id} className={styles.friendCard}>
                        {friend.profile_picture ? (
                          <img 
                            src={friend.profile_picture} 
                            alt={friend.display_name || friend.username || 'Friend'}
                            className={styles.friendAvatar}
                          />
                        ) : (
                          <div className={styles.friendAvatarPlaceholder}>
                            {(friend.display_name || friend.username || 'F')[0].toUpperCase()}
                          </div>
                        )}
                        <div className={styles.friendName}>
                          {friend.display_name || friend.username || 'Friend'}
                        </div>
                      </div>
                    ))}
                  </div>
                  {friends.length > 12 && (
                    <div className={styles.moreFriends}>
                      +{friends.length - 12} more
                    </div>
                  )}
                </div>
              )}
              
              {friends.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <EmptyState
                    title="No friends yet"
                    message="Invite friends or search by username to start building your circle."
                    actionLabel="Invite friends"
                    onAction={() => setShowInviteFriends(true)}
                  />
                  <button
                    className={styles.actionBtn}
                    onClick={() => navigate('/', { state: { openAddFriend: true } })}
                    style={{ marginTop: '-22px' }}
                  >
                    Find friends
                  </button>
                </div>
              )}
              
              {friends.length > 0 && (
                <button
                  className={styles.actionBtn}
                  onClick={() => setShowInviteFriends(true)}
                  style={{ marginTop: 'var(--space-md)', width: '100%' }}
                >
                  Invite Friends
                </button>
              )}
            </>
          )}
        </div>

        {/* Privacy Section */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Privacy</h2>
          <div className={styles.privacyCard}>
            <div className={styles.privacyRow}>
              <div>
                <div className={styles.privacyLabel}>Default visibility</div>
                <div className={styles.privacySubtext}>
                  New sessions you share to your feed will use this by default.
                </div>
              </div>
              <div className={styles.visibilityToggle}>
                {['public', 'friends', 'private'].map(v => (
                  <button
                    key={v}
                    type="button"
                    className={`${styles.visibilityBtn} ${defaultVisibility === v ? styles.visibilityActive : ''}`}
                    onClick={async () => {
                      setDefaultVisibility(v)
                      if (user) {
                        await setDefaultVisibilityPreference(user.id, v)
                      }
                      showToast('Default visibility updated', 'success')
                    }}
                  >
                    {v === 'public' ? 'Public' : v === 'friends' ? 'Friends' : 'Private'}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.privacyNote}>
              Public-by-default helps the social feed feel alive—but you’re always in control. You can override visibility each time you share.
            </div>
          </div>
        </div>

        {/* User Activity Stats */}
        {userEventStats && userEventStats.totalEvents > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Activity</h2>
            <div className={styles.activityStats}>
              <div className={styles.activityStat}>
                <div className={styles.activityStatValue}>{userEventStats.sessions}</div>
                <div className={styles.activityStatLabel}>Sessions (30 days)</div>
              </div>
              <div className={styles.activityStat}>
                <div className={styles.activityStatValue}>{userEventStats.totalEvents}</div>
                <div className={styles.activityStatLabel}>Total Actions</div>
              </div>
              {userEventStats.mostUsedFeatures.length > 0 && (
                <div className={styles.activityStat}>
                  <div className={styles.activityStatValue}>
                    {userEventStats.mostUsedFeatures[0].count}
                  </div>
                  <div className={styles.activityStatLabel}>
                    {userEventStats.mostUsedFeatures[0].name.replace(/_/g, ' ')}
                  </div>
                </div>
              )}
            </div>
            {userEventStats.mostUsedFeatures.length > 1 && (
              <div className={styles.topFeatures}>
                <h3 className={styles.topFeaturesTitle}>Most Used Features</h3>
                <ul className={styles.topFeaturesList}>
                  {userEventStats.mostUsedFeatures.slice(0, 5).map((feature, idx) => (
                    <li key={idx} className={styles.topFeatureItem}>
                      <span className={styles.topFeatureName}>
                        {feature.name.replace(/_/g, ' ')}
                      </span>
                      <span className={styles.topFeatureCount}>{feature.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Data Export</h2>
          <div style={{ position: 'relative' }}>
            <button
              className={styles.actionBtn}
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={exporting}
            >
              {exporting ? 'Exporting...' : 'Export Data'}
            </button>
            {showExportMenu && !exporting && (
              <div className={styles.exportMenu}>
                <button
                  className={styles.exportOption}
                  onClick={() => handleExport('json')}
                >
                  <span className={styles.exportIcon} aria-hidden="true">JSON</span>
                  <div>
                    <div className={styles.exportTitle}>All Data (JSON)</div>
                    <div className={styles.exportDesc}>Complete backup of all your data</div>
                  </div>
                </button>
                <button
                  className={styles.exportOption}
                  onClick={() => handleExport('workouts-csv')}
                >
                  <span className={styles.exportIcon} aria-hidden="true">CSV</span>
                  <div>
                    <div className={styles.exportTitle}>Workouts (CSV)</div>
                    <div className={styles.exportDesc}>Workout history in spreadsheet format</div>
                  </div>
                </button>
                <button
                  className={styles.exportOption}
                  onClick={() => handleExport('metrics-csv')}
                >
                  <span className={styles.exportIcon} aria-hidden="true">CSV</span>
                  <div>
                    <div className={styles.exportTitle}>Health Metrics (CSV)</div>
                    <div className={styles.exportDesc}>Sleep, HRV, steps, weight, etc.</div>
                  </div>
                </button>
                <button
                  className={styles.exportOption}
                  onClick={() => handleExport('excel')}
                >
                  <span className={styles.exportIcon} aria-hidden="true">XLSX</span>
                  <div>
                    <div className={styles.exportTitle}>Excel (Legacy)</div>
                    <div className={styles.exportDesc}>Opens email with Excel attachment</div>
                  </div>
                </button>
              </div>
            )}
          </div>
          <p className={styles.exportNote}>
            Export your data for backup or analysis. GDPR compliant.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Connected Accounts</h2>
          {loading ? (
            <div className={styles.loading} style={{ width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Skeleton style={{ width: '45%', height: 16 }} />
                <Skeleton style={{ width: '100%', height: 120 }} />
              </div>
            </div>
          ) : connectedAccounts.length === 0 ? (
            <EmptyState
              title="No accounts connected"
              message="Connect Fitbit or Oura to populate readiness and daily metrics."
              actionLabel="Connect account"
              onAction={() => navigate('/wearables')}
            />
          ) : (
            <div className={styles.accountsList}>
              {connectedAccounts.map(account => (
                <div key={account.id} className={styles.accountItem}>
                  <div className={styles.accountInfo}>
                    <span className={styles.accountProvider}>
                      {account.provider.charAt(0).toUpperCase() + account.provider.slice(1)}
                    </span>
                    <span className={styles.accountStatus}>Connected</span>
                  </div>
                  <button
                    className={styles.disconnectBtn}
                    onClick={() => handleDisconnect(account.provider)}
                  >
                    Disconnect
                  </button>
                </div>
              ))}
              <button
                className={styles.actionBtn}
                onClick={() => navigate('/wearables')}
                style={{ marginTop: '12px' }}
              >
                Manage Wearables
              </button>
            </div>
          )}
        </div>

        {/* Support / Legal (App Store compliance: support URL + legal docs accessible in-app) */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Support & Legal</h2>
          <div className={styles.supportRow}>
            <button className={styles.actionBtn} onClick={() => navigate('/pricing')}>Pro</button>
            <button className={styles.actionBtn} onClick={() => navigate(SUPPORT_PATH)}>Support</button>
            <button className={styles.actionBtn} onClick={() => navigate(PRIVACY_PATH)}>Privacy Policy</button>
            <button className={styles.actionBtn} onClick={() => navigate(TERMS_PATH)}>Terms</button>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Account</h2>
          <button
            className={styles.logoutBtn}
            onClick={() => {
              if (handleLogout && typeof handleLogout === 'function') {
                handleLogout()
              }
            }}
          >
            Sign Out
          </button>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Danger Zone</h2>
          {!showDeleteConfirm ? (
            <button
              className={styles.deleteBtn}
              onClick={() => {
                if (handleDeleteAccount && typeof handleDeleteAccount === 'function') {
                  handleDeleteAccount()
                }
              }}
              disabled={deleting}
            >
              Delete Account
            </button>
          ) : (
            <div className={styles.deleteConfirm}>
              <p className={styles.deleteWarning}>
                This will permanently delete ALL your data. This action cannot be undone.
              </p>
              <p className={styles.deleteInstruction}>
                Type <strong>DELETE</strong> to confirm:
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE"
                className={styles.deleteInput}
                autoFocus
              />
              <div className={styles.deleteActions}>
                <button
                  className={styles.deleteConfirmBtn}
                  onClick={() => {
                    if (handleDeleteAccount && typeof handleDeleteAccount === 'function') {
                      handleDeleteAccount()
                    }
                  }}
                  disabled={deleting || deleteConfirmText !== 'DELETE'}
                >
                  {deleting ? 'Deleting...' : 'Permanently Delete Account'}
                </button>
                <button
                  className={styles.deleteCancelBtn}
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeleteConfirmText('')
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showInviteFriends && (
        <InviteFriends onClose={() => setShowInviteFriends(false)} />
      )}

      <ConfirmDialog
        open={disconnectConfirm.open}
        title="Disconnect wearable?"
        message={disconnectConfirm.provider ? `Disconnect ${disconnectConfirm.provider}? This will stop syncing data from this account.` : ''}
        confirmText="Disconnect"
        cancelText="Cancel"
        destructive
        onCancel={() => setDisconnectConfirm({ open: false, provider: null })}
        onConfirm={confirmDisconnect}
      />

      <ConfirmDialog
        open={finalDeleteConfirmOpen}
        title="Final warning"
        message={
          'This will permanently delete ALL your data including:\n\n' +
          '• All workouts and exercise history\n' +
          '• All health metrics and nutrition data\n' +
          '• All goals and preferences\n' +
          '• All connected accounts\n\n' +
          'This action cannot be undone. Are you absolutely sure?'
        }
        confirmText={deleting ? 'Deleting…' : 'Delete everything'}
        cancelText="Cancel"
        destructive
        onCancel={() => {
          setFinalDeleteConfirmOpen(false)
          setShowDeleteConfirm(false)
          setDeleteConfirmText('')
        }}
        onConfirm={() => {
          setFinalDeleteConfirmOpen(false)
          performDeleteAccount()
        }}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
    </div>
  )
}

