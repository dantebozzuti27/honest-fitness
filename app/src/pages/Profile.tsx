import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { exportUserDataJSON, exportWorkoutsCSV, exportHealthMetricsCSV, downloadData } from '../lib/dataExport'
import { getAllConnectedAccounts, disconnectAccount } from '../lib/wearables'
import { connectFitbit } from '../lib/fitbitAuth'
import { getUserPreferences, saveUserPreferences } from '../lib/db/userPreferencesDb'
import { deleteUserAccount } from '../lib/accountDeletion'
import { supabase } from '../lib/supabase'
import { getTodayEST } from '../utils/dateUtils'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import BackButton from '../components/BackButton'
import InputField from '../components/InputField'
import Button from '../components/Button'
import { logError } from '../utils/logger'
import styles from './Profile.module.css'

export default function Profile() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [exporting, setExporting] = useState(false)
  const [connectedAccounts, setConnectedAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [finalDeleteConfirmOpen, setFinalDeleteConfirmOpen] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [disconnectConfirm, setDisconnectConfirm] = useState<{ open: boolean; provider: string | null }>({ open: false, provider: null })
  const shownErrorsRef = useRef({ connected: false })

  useEffect(() => {
    if (user) loadConnectedAccounts()
  }, [user])

  const loadConnectedAccounts = async () => {
    if (!user) return
    try {
      const accounts = await getAllConnectedAccounts(user.id)
      setConnectedAccounts(accounts || [])
    } catch (error) {
      logError('Connected accounts load error', error)
      if (!shownErrorsRef.current.connected) {
        shownErrorsRef.current.connected = true
        showToast('Failed to load connected accounts.', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleConnectFitbit = async () => {
    if (!user) return
    try {
      await connectFitbit(user.id)
    } catch (error) {
      logError('Fitbit connect error', error)
      showToast('Failed to connect Fitbit. Please try again.', 'error')
    }
  }

  const handleDisconnect = async (provider: string) => {
    setDisconnectConfirm({ open: true, provider })
  }

  const confirmDisconnect = async () => {
    if (!user || !disconnectConfirm.provider) {
      setDisconnectConfirm({ open: false, provider: null })
      return
    }
    try {
      await disconnectAccount(user.id, disconnectConfirm.provider)
      await loadConnectedAccounts()
      showToast(`${disconnectConfirm.provider} disconnected`, 'success')
    } catch (error) {
      showToast('Failed to disconnect. Please try again.', 'error')
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
      }
      setShowExportMenu(false)
    } catch (err) {
      logError('Export error', err)
      showToast('Failed to export data.', 'error')
    }
    setExporting(false)
  }

  const handleLogout = async () => {
    await signOut()
    navigate('/auth')
  }

  const handleDeleteAccount = () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true)
      return
    }
    if (deleteConfirmText !== 'DELETE') {
      showToast('Please type "DELETE" to confirm', 'error')
      return
    }
    setFinalDeleteConfirmOpen(true)
  }

  const performDeleteAccount = async () => {
    if (!user) return
    setDeleting(true)
    try {
      await deleteUserAccount(user.id)
      await signOut()
      showToast('Account permanently deleted.', 'success', 6000)
      navigate('/auth')
    } catch (error) {
      logError('Account deletion error', error)
      showToast('Failed to delete account.', 'error', 7000)
      setDeleting(false)
      setShowDeleteConfirm(false)
      setDeleteConfirmText('')
      setFinalDeleteConfirmOpen(false)
    }
  }

  const fitbitAccount = connectedAccounts.find((a: any) => a.provider === 'fitbit')

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <BackButton fallbackPath="/" />
        <h1>Settings</h1>
        <div style={{ width: 32 }} />
      </div>

      <div className={styles.content} style={{ paddingBottom: '120px' }}>
        {user && (
          <>
            {/* Account */}
            <section style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', margin: '16px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--text-primary)' }}>Account</h2>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {user.email}
              </div>
            </section>

            {/* Fitbit Connection */}
            <section style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', margin: '0 16px 16px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--text-primary)' }}>Fitbit</h2>
              {loading ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading...</div>
              ) : fitbitAccount ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: 'var(--success)', fontWeight: 600, fontSize: '14px' }}>Connected</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                      {fitbitAccount.provider_email || 'Fitbit account'}
                    </div>
                  </div>
                  <Button variant="destructive" onClick={() => handleDisconnect('fitbit')}>
                    Disconnect
                  </Button>
                </div>
              ) : (
                <div>
                  <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    Connect Fitbit to automatically sync steps, sleep, and heart rate data.
                  </p>
                  <Button onClick={handleConnectFitbit}>Connect Fitbit</Button>
                </div>
              )}
            </section>

            {/* Data Export */}
            <section style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', margin: '0 16px 16px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--text-primary)' }}>Export Data</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Button variant="secondary" onClick={() => handleExport('json')} loading={exporting} disabled={exporting}>
                  Export All Data (JSON)
                </Button>
                <Button variant="secondary" onClick={() => handleExport('workouts-csv')} loading={exporting} disabled={exporting}>
                  Export Workouts (CSV)
                </Button>
                <Button variant="secondary" onClick={() => handleExport('metrics-csv')} loading={exporting} disabled={exporting}>
                  Export Health Metrics (CSV)
                </Button>
              </div>
            </section>

            {/* Sign Out */}
            <section style={{ padding: '16px', margin: '0 16px 16px' }}>
              <Button variant="secondary" onClick={handleLogout} style={{ width: '100%' }}>
                Sign Out
              </Button>
            </section>

            {/* Danger Zone */}
            <section style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', margin: '0 16px 16px', border: '1px solid var(--danger, #ef4444)' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--danger, #ef4444)' }}>Danger Zone</h2>
              {!showDeleteConfirm ? (
                <Button variant="destructive" onClick={handleDeleteAccount}>
                  Delete Account
                </Button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>
                    This will permanently delete all your data. Type <strong>DELETE</strong> to confirm.
                  </p>
                  <InputField
                    label=""
                    value={deleteConfirmText}
                    onChange={(e: any) => setDeleteConfirmText(e.target.value)}
                    placeholder='Type "DELETE"'
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button variant="destructive" onClick={handleDeleteAccount} loading={deleting} disabled={deleteConfirmText !== 'DELETE'}>
                      Confirm Delete
                    </Button>
                    <Button variant="secondary" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText('') }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Disconnect confirmation */}
      <ConfirmDialog
        isOpen={disconnectConfirm.open}
        title={`Disconnect ${disconnectConfirm.provider}?`}
        message="This will stop syncing data from this device."
        confirmText="Disconnect"
        cancelText="Cancel"
        isDestructive
        onClose={() => setDisconnectConfirm({ open: false, provider: null })}
        onConfirm={confirmDisconnect}
      />

      {/* Final delete confirmation */}
      <ConfirmDialog
        isOpen={finalDeleteConfirmOpen}
        title="Permanently delete account?"
        message="This action cannot be undone. All your workouts, metrics, and data will be permanently deleted."
        confirmText="Delete Everything"
        cancelText="Cancel"
        isDestructive
        onClose={() => setFinalDeleteConfirmOpen(false)}
        onConfirm={performDeleteAccount}
      />

      {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
    </div>
  )
}
