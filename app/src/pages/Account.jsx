import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { exportWorkoutData } from '../utils/exportData'
import { getAllConnectedAccounts, disconnectAccount } from '../lib/wearables'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import BackButton from '../components/BackButton'
import Skeleton from '../components/Skeleton'
import styles from './Account.module.css'

export default function Account() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [exporting, setExporting] = useState(false)
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [disconnectConfirm, setDisconnectConfirm] = useState({ open: false, provider: null })
  const shownConnectedErrorRef = useRef(false)

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
      if (!shownConnectedErrorRef.current) {
        shownConnectedErrorRef.current = true
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

  const handleExport = async () => {
    if (!user) return
    setExporting(true)
    try {
      const result = await exportWorkoutData(user.id, user.email)
      showToast(`Exported ${result.workouts} workouts and ${result.metrics} daily metrics.`, 'success', 6000)
    } catch (err) {
      showToast('Failed to export data. Please try again.', 'error')
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
        <BackButton fallbackPath="/" />
        <h1>Account</h1>
      </div>

      <div className={styles.content}>
        {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
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

        <div className={styles.section}>
          <button
            className={styles.logoutBtn}
            onClick={handleLogout}
          >
            Sign Out
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={disconnectConfirm.open}
        title={`Disconnect ${disconnectConfirm.provider || ''}?`}
        message="This will stop syncing data from this account."
        confirmText="Disconnect"
        cancelText="Cancel"
        isDestructive
        onClose={() => setDisconnectConfirm({ open: false, provider: null })}
        onConfirm={async () => {
          const provider = disconnectConfirm.provider
          if (!provider || !user) return
          try {
            await disconnectAccount(user.id, provider)
            await loadConnectedAccounts()
            showToast(`${provider} disconnected`, 'success')
          } catch (e) {
            showToast(`Failed to disconnect ${provider}.`, 'error')
          } finally {
            setDisconnectConfirm({ open: false, provider: null })
          }
        }}
      />
    </div>
  )
}

