import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { exportWorkoutData } from '../utils/exportData'
import { exportUserDataJSON, exportWorkoutsCSV, exportHealthMetricsCSV, downloadData } from '../lib/dataExport'
import { getAllConnectedAccounts, disconnectAccount } from '../lib/wearables'
import { getUserPreferences, saveUserPreferences } from '../lib/supabaseDb'
import { getUserProfile, updateUserProfile, getOrCreateUserProfile, getFriends, getFriendCount, getPendingFriendRequests } from '../lib/friendsDb'
import { deleteUserAccount } from '../lib/accountDeletion'
import { supabase } from '../lib/supabase'
import HomeButton from '../components/HomeButton'
import InviteFriends from '../components/InviteFriends'
import styles from './Profile.module.css'

export default function Profile() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
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
  const [showExportMenu, setShowExportMenu] = useState(false)

  useEffect(() => {
    if (user) {
      loadConnectedAccounts()
      loadProfile()
      loadSocialData()
    }
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
      // Silently fail
    }
  }

  const handleProfilePictureChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    
    try {
      // Convert to base64 (simpler than storage bucket)
      const reader = new FileReader()
      reader.onloadend = async () => {
        try {
          const base64String = reader.result
          setProfilePictureUrl(base64String)
          setProfilePicture(base64String)
        } catch (error) {
          console.error('Profile picture read error:', error)
          alert('Failed to read image file. Please try again.')
        }
      }
      reader.onerror = () => {
        alert('Failed to read image file. Please try again.')
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error('Profile picture upload error:', error)
      alert(`Failed to upload profile picture: ${error.message || 'Please try again.'}`)
    }
  }

  const handleSaveProfile = async () => {
    if (!user) return
    
    // Validate required fields
    if (!username.trim()) {
      alert('Username is required')
      return
    }
    
    if (!phoneNumber.trim()) {
      alert('Phone number is required')
      return
    }
    
    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/
    if (!usernameRegex.test(username.trim())) {
      alert('Username must be 3-20 characters and contain only letters, numbers, underscores, or hyphens')
      return
    }
    
    // Validate phone number
    const digitsOnly = phoneNumber.replace(/\D/g, '')
    if (digitsOnly.length < 10) {
      alert('Please enter a valid phone number')
      return
    }
    
    setSaving(true)
    try {
      // Update user profile (username, phone, display_name, bio, profile_picture)
      await updateUserProfile(user.id, {
        username: username.trim().toLowerCase(),
        phone_number: phoneNumber.trim(),
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
      
      alert('Profile updated successfully!')
    } catch (error) {
      console.error('Profile save error:', error)
      alert(`Failed to update profile: ${error.message || 'Please try again.'}`)
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
      // Silently fail
    } finally {
      setLoadingSocial(false)
    }
  }

  const loadConnectedAccounts = async () => {
    if (!user) return
    try {
      const accounts = await getAllConnectedAccounts(user.id)
      setConnectedAccounts(accounts || [])
    } catch (error) {
      // Silently fail - will retry on next render
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async (provider) => {
    if (!user) return
    if (!confirm(`Disconnect ${provider}? This will stop syncing data from this account.`)) return
    
    try {
      await disconnectAccount(user.id, provider)
      await loadConnectedAccounts()
      alert(`${provider} disconnected successfully`)
    } catch (error) {
      alert(`Failed to disconnect ${provider}. Please try again.`)
    }
  }

  const handleExport = async (format = 'json') => {
    if (!user) return
    setExporting(true)
    try {
      if (format === 'json') {
        const data = await exportUserDataJSON(user.id)
        downloadData(data, `honest-fitness-data-${new Date().toISOString().split('T')[0]}.json`, 'application/json')
        alert('All data exported as JSON!')
      } else if (format === 'workouts-csv') {
        const csv = await exportWorkoutsCSV(user.id)
        downloadData(csv, `workouts-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv')
        alert('Workouts exported as CSV!')
      } else if (format === 'metrics-csv') {
        const csv = await exportHealthMetricsCSV(user.id)
        downloadData(csv, `health-metrics-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv')
        alert('Health metrics exported as CSV!')
      } else if (format === 'excel') {
        // Legacy Excel export
        const result = await exportWorkoutData(user.id, user.email)
        alert(`Exported ${result.workouts} workouts and ${result.metrics} daily metrics!\n\nThe Excel file has been downloaded. Attach it to the email that just opened.`)
      }
      setShowExportMenu(false)
    } catch (err) {
      console.error('Export error:', err)
      alert('Failed to export data. Please try again.')
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
      alert('Please type "DELETE" to confirm account deletion')
      return
    }

    const finalConfirm = confirm(
      '⚠️ FINAL WARNING: This will permanently delete ALL your data including:\n\n' +
      '• All workouts and exercise history\n' +
      '• All health metrics and nutrition data\n' +
      '• All goals and preferences\n' +
      '• All connected accounts\n\n' +
      'This action CANNOT be undone. Are you absolutely sure?'
    )

    if (!finalConfirm) {
      setShowDeleteConfirm(false)
      setDeleteConfirmText('')
      return
    }

    setDeleting(true)
    try {
      await deleteUserAccount(user.id)
      
      // Sign out and redirect
      await signOut()
      alert('Your account and all data have been permanently deleted.')
      navigate('/auth')
    } catch (error) {
      console.error('Account deletion error:', error)
      alert(`Failed to delete account: ${error.message || 'Please try again or contact support.'}`)
      setDeleting(false)
      setShowDeleteConfirm(false)
      setDeleteConfirmText('')
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
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

            {/* Edit Modal */}
            {showEditModal && (
              <div className={styles.editModalOverlay} onClick={() => setShowEditModal(false)}>
                <div className={styles.editModal} onClick={(e) => e.stopPropagation()}>
                  <div className={styles.editModalHeader}>
                    <h3>Edit Profile</h3>
                    <button className={styles.closeBtn} onClick={() => setShowEditModal(false)}>×</button>
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
                      <label className={styles.label}>Phone Number *</label>
                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+1 (555) 123-4567"
                        className={styles.input}
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label}>Display Name</label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your display name"
                        className={styles.input}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label}>Bio</label>
                      <textarea
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="Tell us about yourself..."
                        className={styles.textarea}
                        rows={3}
                        maxLength={500}
                      />
                    </div>

                    <button
                      className={styles.saveBtn}
                      onClick={async () => {
                        await handleSaveProfile()
                        setShowEditModal(false)
                      }}
                      disabled={saving}
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Social Section */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Social</h2>
          {loadingSocial ? (
            <div className={styles.loading}>Loading...</div>
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
                <div className={styles.emptyState}>
                  <p className={styles.emptyText}>No friends yet</p>
                  <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => setShowInviteFriends(true)}
                    >
                      Invite Friends
                    </button>
                    <button
                      className={styles.actionBtn}
                      onClick={() => navigate('/')}
                    >
                      Find Friends
                    </button>
                  </div>
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
                  <span className={styles.exportIcon}>📦</span>
                  <div>
                    <div className={styles.exportTitle}>All Data (JSON)</div>
                    <div className={styles.exportDesc}>Complete backup of all your data</div>
                  </div>
                </button>
                <button
                  className={styles.exportOption}
                  onClick={() => handleExport('workouts-csv')}
                >
                  <span className={styles.exportIcon}>💪</span>
                  <div>
                    <div className={styles.exportTitle}>Workouts (CSV)</div>
                    <div className={styles.exportDesc}>Workout history in spreadsheet format</div>
                  </div>
                </button>
                <button
                  className={styles.exportOption}
                  onClick={() => handleExport('metrics-csv')}
                >
                  <span className={styles.exportIcon}>📊</span>
                  <div>
                    <div className={styles.exportTitle}>Health Metrics (CSV)</div>
                    <div className={styles.exportDesc}>Sleep, HRV, steps, weight, etc.</div>
                  </div>
                </button>
                <button
                  className={styles.exportOption}
                  onClick={() => handleExport('excel')}
                >
                  <span className={styles.exportIcon}>📧</span>
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
            <div className={styles.loading}>Loading...</div>
          ) : connectedAccounts.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>No accounts connected</p>
              <button
                className={styles.actionBtn}
                onClick={() => navigate('/wearables')}
              >
                Connect Account
              </button>
            </div>
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
                ⚠️ This will permanently delete ALL your data. This action cannot be undone.
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
    </div>
  )
}

