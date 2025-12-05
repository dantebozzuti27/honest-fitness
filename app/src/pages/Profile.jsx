import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { exportWorkoutData } from '../utils/exportData'
import { getAllConnectedAccounts, disconnectAccount } from '../lib/wearables'
import HomeButton from '../components/HomeButton'
import styles from './Profile.module.css'

export default function Profile() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [exporting, setExporting] = useState(false)
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      loadConnectedAccounts()
    }
  }, [user])

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

  const handleExport = async () => {
    if (!user) return
    setExporting(true)
    try {
      const result = await exportWorkoutData(user.id, user.email)
      alert(`Exported ${result.workouts} workouts and ${result.metrics} daily metrics!\n\nThe Excel file has been downloaded. Attach it to the email that just opened.`)
    } catch (err) {
      alert('Failed to export data. Please try again.')
    }
    setExporting(false)
  }



  const handleLogout = async () => {
    await signOut()
    navigate('/auth')
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
          <div className={styles.userInfo}>
            <div className={styles.userEmail}>{user.email}</div>
          </div>
        )}

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Data</h2>
          <button
            className={styles.actionBtn}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Export All Data'}
          </button>
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
          <button
            className={styles.logoutBtn}
            onClick={handleLogout}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}

