import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { 
  getAllConnectedAccounts, 
  disconnectAccount,
  syncFitbitData,
  syncOuraData,
  mergeWearableDataToMetrics
} from '../lib/wearables'
import { connectFitbit } from '../lib/fitbitAuth'
import { connectOura } from '../lib/ouraAuth'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import BackButton from '../components/BackButton'
import Skeleton from '../components/Skeleton'
import styles from './Wearables.module.css'

export default function Wearables() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)
  const { toast, showToast, hideToast } = useToast()
  const [confirmState, setConfirmState] = useState({ open: false, provider: null })
  const shownLoadErrorRef = useRef(false)
  const fitbitClientId = import.meta.env.VITE_FITBIT_CLIENT_ID
  const ouraClientId = import.meta.env.VITE_OURA_CLIENT_ID

  useEffect(() => {
    if (user) {
      loadConnectedAccounts()
    }
    
    // Environment variables are checked in fitbitAuth
  }, [user])

  const loadConnectedAccounts = async () => {
    if (!user) return
    
    try {
      const accounts = await getAllConnectedAccounts(user.id)
      setConnectedAccounts(accounts || [])
    } catch (error) {
      if (!shownLoadErrorRef.current) {
        shownLoadErrorRef.current = true
        showToast('Failed to load connected accounts. Please try again.', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleConnectFitbit = () => {
    if (!user) {
      showToast('Please log in to connect Fitbit', 'error')
      return
    }
    
    try {
      connectFitbit(user.id)
    } catch (error) {
      showToast(`Error connecting Fitbit: ${error.message}`, 'error')
    }
  }

  const handleConnectOura = () => {
    if (!user) {
      showToast('Please log in to connect Oura', 'error')
      return
    }
    
    // OAuth 2.0 is required for production (industry standard, compliant)
    if (!ouraClientId) {
      showToast(
        'Oura OAuth is not configured.\n\n' +
        'OAuth 2.0 is required for production use to ensure:\n' +
        '• Industry-standard security\n' +
        '• GDPR/CCPA compliance\n' +
        '• Scalable user authentication\n' +
        '• Automatic token refresh\n\n' +
        'Please configure OAuth credentials in environment variables:\n' +
        '• OURA_CLIENT_ID\n' +
        '• OURA_CLIENT_SECRET\n' +
        '• OURA_REDIRECT_URI\n' +
        '• VITE_OURA_CLIENT_ID\n' +
        '• VITE_OURA_REDIRECT_URI',
        'error',
        8000
      )
      return
    }
    
    try {
      connectOura(user.id)
    } catch (error) {
      showToast(`Error connecting Oura: ${error.message}`, 'error')
    }
  }


  const handleDisconnect = async (provider) => {
    if (!user) return

    setConfirmState({ open: true, provider })
  }

  const confirmDisconnect = async () => {
    const provider = confirmState.provider
    if (!provider || !user) {
      setConfirmState({ open: false, provider: null })
      return
    }

    try {
      await disconnectAccount(user.id, provider)
      await loadConnectedAccounts()
      showToast(`${provider} disconnected successfully`, 'success')
    } catch (error) {
      showToast(`Failed to disconnect ${provider}. Please try again.`, 'error')
    } finally {
      setConfirmState({ open: false, provider: null })
    }
  }

  const handleSync = async (provider) => {
    if (!user) return
    
    setSyncing(true)
    setSyncStatus(null)
    
    try {
      if (provider === 'fitbit') {
        // Sync today's data
        const today = getTodayEST()
        const result = await syncFitbitData(user.id, today)
        
        // Also sync yesterday to ensure we have recent data
        const yesterday = getYesterdayEST()
        try {
          await syncFitbitData(user.id, yesterday)
        } catch (e) {
          // Yesterday sync is optional, continue
        }
        
        // Merge into daily_metrics
        await mergeWearableDataToMetrics(user.id, today)
        
        setSyncStatus({
          success: true,
          message: `Synced Fitbit data for ${result.date}`,
          data: result.data
        })
        
        // Reload connected accounts to show updated status
        await loadConnectedAccounts()
      } else if (provider === 'oura') {
        // Sync today's data
        const today = getTodayEST()
        const result = await syncOuraData(user.id, today)
        
        // Also sync yesterday to ensure we have recent data
        const yesterday = getYesterdayEST()
        try {
          await syncOuraData(user.id, yesterday)
        } catch (e) {
          // Yesterday sync is optional, continue
        }
        
        // Merge into daily_metrics
        await mergeWearableDataToMetrics(user.id, today)
        
        setSyncStatus({
          success: true,
          message: `Synced Oura data for ${result.date}`,
          data: result.data
        })
        
        // Reload connected accounts to show updated status
        await loadConnectedAccounts()
      }
    } catch (error) {
      setSyncStatus({
        success: false,
        message: error.message || 'Failed to sync data. Please check your connection and try again.'
      })
    } finally {
      setSyncing(false)
    }
  }

  // Check for OAuth callback messages
  useEffect(() => {
    if (!user) return
    
    const params = new URLSearchParams(window.location.search)
    const fitbitConnected = params.get('fitbit_connected')
    const fitbitError = params.get('fitbit_error')
    const ouraConnected = params.get('oura_connected')
    const ouraError = params.get('oura_error')
    
    if (fitbitConnected) {
      showToast('Fitbit connected successfully!', 'success')
      loadConnectedAccounts()
      
      // Auto-sync data after connection
      setTimeout(async () => {
        try {
          setSyncing(true)
          const today = getTodayEST()
          const result = await syncFitbitData(user.id, today)
          
          // Also sync yesterday
          const { getYesterdayEST } = await import('../utils/dateUtils')
          const yesterday = getYesterdayEST()
          try {
            await syncFitbitData(user.id, yesterday)
          } catch (e) {
            // Yesterday sync is optional, continue
          }
          
          await mergeWearableDataToMetrics(user.id, today)
          setSyncStatus({
            success: true,
            message: `Synced Fitbit data for ${result.date}`,
            data: result.data
          })
          setSyncing(false)
        } catch (error) {
          setSyncStatus({
            success: false,
            message: error.message || 'Auto-sync failed. You can sync manually.'
          })
          setSyncing(false)
        }
      }, 1000)
      
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    
    if (fitbitError) {
      showToast(`Fitbit connection error: ${decodeURIComponent(fitbitError)}`, 'error', 6000)
      window.history.replaceState({}, document.title, window.location.pathname)
    }

    if (ouraConnected) {
      showToast('Oura connected successfully!', 'success')
      loadConnectedAccounts()
      
      // Auto-sync data after connection
      setTimeout(async () => {
        try {
          setSyncing(true)
          const today = getTodayEST()
          const result = await syncOuraData(user.id, today)
          
          // Also sync yesterday
          const { getYesterdayEST } = await import('../utils/dateUtils')
          const yesterday = getYesterdayEST()
          try {
            await syncOuraData(user.id, yesterday)
          } catch (e) {
            // Yesterday sync is optional, continue
          }
          
          await mergeWearableDataToMetrics(user.id, today)
          setSyncStatus({
            success: true,
            message: `Synced Oura data for ${result.date}`,
            data: result.data
          })
          setSyncing(false)
        } catch (error) {
          setSyncStatus({
            success: false,
            message: error.message || 'Auto-sync failed. You can sync manually.'
          })
          setSyncing(false)
        }
      }, 1000)
      
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    
    if (ouraError) {
      showToast(`Oura connection error: ${decodeURIComponent(ouraError)}`, 'error', 6000)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [user])

  const fitbitAccount = connectedAccounts.find(a => a.provider === 'fitbit')
  const ouraAccount = connectedAccounts.find(a => a.provider === 'oura')

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading} style={{ width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton style={{ width: '40%', height: 16 }} />
            <Skeleton style={{ width: '100%', height: 140 }} />
            <Skeleton style={{ width: '100%', height: 140 }} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <BackButton fallbackPath="/" />
        <h1>Wearables</h1>
        <div style={{ width: 60 }} /> {/* Spacer */}
      </div>

      <div className={styles.content}>
        {/* Fitbit Section */}
        <div className={styles.providerCard}>
          <div className={styles.providerHeader}>
              <div className={styles.providerInfo}>
              <div>
                <h2>Fitbit</h2>
                <p className={styles.providerDesc}>
                  Connect your Fitbit account to sync steps, heart rate, sleep, and activity data
                </p>
              </div>
            </div>
            {fitbitAccount ? (
              <div className={styles.connectedBadge}>Connected</div>
            ) : (
              <>
                {!fitbitClientId && (
                  <div style={{ 
                    padding: '10px', 
                    background: '#ffebee', 
                    color: '#c62828', 
                    borderRadius: '4px',
                    marginBottom: '10px',
                    fontSize: '14px'
                  }}>
                    Warning: Fitbit Client ID not configured. Please set VITE_FITBIT_CLIENT_ID in your environment variables.
                  </div>
                )}
                <button
                  className={styles.connectBtn}
                  onClick={() => {
                    if (handleConnectFitbit && typeof handleConnectFitbit === 'function') {
                      handleConnectFitbit()
                    }
                  }}
                  disabled={!fitbitClientId}
                >
                  Sign In with Fitbit
                </button>
              </>
            )}
          </div>

          {fitbitAccount && (
            <div className={styles.accountDetails}>
              <div className={styles.detailRow}>
                <span>Status:</span>
                <span className={styles.statusConnected}>● Connected</span>
              </div>
              <div className={styles.detailRow}>
                <span>Last Updated:</span>
                <span>
                  {fitbitAccount.updated_at 
                    ? new Date(fitbitAccount.updated_at).toLocaleDateString()
                    : 'Never'}
                </span>
              </div>
              
              <div className={styles.actions}>
                <button
                  className={styles.syncBtn}
                  onClick={() => handleSync('fitbit')}
                  disabled={syncing}
                >
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  className={styles.disconnectBtn}
                  onClick={() => handleDisconnect('fitbit')}
                >
                  Disconnect
                </button>
              </div>

              {syncStatus && (
                <div className={`${styles.syncStatus} ${syncStatus.success ? styles.success : styles.error}`}>
                  {syncStatus.message}
                  {syncStatus.data && (
                    <div className={styles.syncData}>
                      {syncStatus.data.steps && <span>Steps: {syncStatus.data.steps}</span>}
                      {syncStatus.data.calories && <span>Calories: {syncStatus.data.calories}</span>}
                      {syncStatus.data.sleep_duration && (
                        <span>Sleep: {Math.round(syncStatus.data.sleep_duration / 60)}h</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className={styles.infoCard}>
          <h3>How It Works</h3>
          <ul className={styles.infoList}>
            <li>Connect your Fitbit account to sync health data</li>
            <li>Data syncs automatically or manually via "Sync Now"</li>
            <li>Sleep, heart rate, and activity data improves your Honest Readiness Score</li>
            <li>All data is stored securely and only you can access it</li>
          </ul>
        </div>

        {/* Oura Section */}
        <div className={styles.providerCard}>
          <div className={styles.providerHeader}>
              <div className={styles.providerInfo}>
              <div>
                <h2>Oura Ring</h2>
                <p className={styles.providerDesc}>
                  Connect your Oura account to sync readiness, sleep, and activity data
                </p>
              </div>
            </div>
            {ouraAccount ? (
              <div className={styles.connectedBadge}>Connected</div>
            ) : (
              <>
                {!ouraClientId && (
                  <div style={{ 
                    padding: '12px', 
                    background: '#ffebee', 
                    color: '#c62828', 
                    borderRadius: '4px',
                    marginBottom: '10px',
                    fontSize: '13px',
                    lineHeight: '1.5'
                  }}>
                    <strong>OAuth 2.0 Required</strong><br/>
                    OAuth credentials must be configured for production use. This ensures industry-standard security and compliance with GDPR/CCPA regulations.
                  </div>
                )}
                <button
                  className={styles.connectBtn}
                  onClick={() => {
                    if (handleConnectOura && typeof handleConnectOura === 'function') {
                      handleConnectOura()
                    }
                  }}
                  disabled={!ouraClientId}
                >
                  Sign In with Oura
                </button>
              </>
            )}
          </div>

          {ouraAccount && (
            <div className={styles.accountDetails}>
              <div className={styles.detailRow}>
                <span>Status:</span>
                <span className={styles.statusConnected}>● Connected</span>
              </div>
              <div className={styles.detailRow}>
                <span>Last Updated:</span>
                <span>
                  {ouraAccount.updated_at 
                    ? new Date(ouraAccount.updated_at).toLocaleDateString()
                    : 'Never'}
                </span>
              </div>
              
              <div className={styles.actions}>
                <button
                  className={styles.syncBtn}
                  onClick={() => handleSync('oura')}
                  disabled={syncing}
                >
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  className={styles.disconnectBtn}
                  onClick={() => handleDisconnect('oura')}
                >
                  Disconnect
                </button>
              </div>

              {syncStatus && (
                <div className={`${styles.syncStatus} ${syncStatus.success ? styles.success : styles.error}`}>
                  {syncStatus.message}
                  {syncStatus.data && (
                    <div className={styles.syncData}>
                      {syncStatus.data.steps && <span>Steps: {syncStatus.data.steps}</span>}
                      {syncStatus.data.calories_burned && <span>Calories: {syncStatus.data.calories_burned}</span>}
                      {syncStatus.data.sleep_duration && (
                        <span>Sleep: {Math.round(syncStatus.data.sleep_duration / 60)}h</span>
                      )}
                      {syncStatus.data.hrv && <span>HRV: {Math.round(syncStatus.data.hrv)}ms</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Coming Soon */}
        <div className={styles.comingSoonCard}>
          <h3>More Wearables Coming Soon</h3>
          <div className={styles.comingSoonList}>
            <div className={styles.comingSoonItem}>
              <span>Garmin</span>
            </div>
            <div className={styles.comingSoonItem}>
              <span>Apple Health</span>
            </div>
            <div className={styles.comingSoonItem}>
              <span>Whoop</span>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmState.open}
        title="Disconnect wearable?"
        message={confirmState.provider ? `Disconnect ${confirmState.provider}? This will stop syncing data from this account.` : ''}
        confirmText="Disconnect"
        cancelText="Cancel"
        destructive
        onCancel={() => setConfirmState({ open: false, provider: null })}
        onConfirm={confirmDisconnect}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
    </div>
  )
}

