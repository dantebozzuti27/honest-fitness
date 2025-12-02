import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { 
  getAllConnectedAccounts, 
  disconnectAccount,
  syncFitbitData,
  mergeWearableDataToMetrics
} from '../lib/wearables'
import { connectFitbit } from '../lib/fitbitAuth'
import { getTodayEST } from '../utils/dateUtils'
import styles from './Wearables.module.css'

export default function Wearables() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)

  useEffect(() => {
    if (user) {
      loadConnectedAccounts()
    }
    
    // Debug: Log environment variables on mount
    console.log('[Wearables] VITE_FITBIT_CLIENT_ID:', import.meta.env.VITE_FITBIT_CLIENT_ID ? 'SET' : 'NOT SET')
    console.log('[Wearables] VITE_FITBIT_REDIRECT_URI:', import.meta.env.VITE_FITBIT_REDIRECT_URI || 'Using default')
  }, [user])

  const loadConnectedAccounts = async () => {
    if (!user) return
    
    try {
      const accounts = await getAllConnectedAccounts(user.id)
      setConnectedAccounts(accounts || [])
    } catch (error) {
      console.error('Error loading connected accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnectFitbit = () => {
    if (!user) {
      alert('Please log in to connect Fitbit')
      return
    }
    
    console.log('handleConnectFitbit called, user:', user)
    
    try {
      connectFitbit(user.id)
    } catch (error) {
      console.error('Error in handleConnectFitbit:', error)
      alert(`Error connecting Fitbit: ${error.message}`)
    }
  }

  const handleDisconnect = async (provider) => {
    if (!user) return
    
    if (!confirm(`Disconnect ${provider}?`)) return
    
    try {
      await disconnectAccount(user.id, provider)
      await loadConnectedAccounts()
      alert(`${provider} disconnected successfully`)
    } catch (error) {
      console.error('Error disconnecting:', error)
      alert(`Failed to disconnect ${provider}`)
    }
  }

  const handleSync = async (provider) => {
    if (!user) return
    
    setSyncing(true)
    setSyncStatus(null)
    
    try {
      if (provider === 'fitbit') {
        const result = await syncFitbitData(user.id)
        
        // Merge into daily_metrics
        await mergeWearableDataToMetrics(user.id, getTodayEST())
        
        setSyncStatus({
          success: true,
          message: `Synced Fitbit data for ${result.date}`,
          data: result.data
        })
      }
    } catch (error) {
      console.error('Sync error:', error)
      setSyncStatus({
        success: false,
        message: error.message || 'Failed to sync data'
      })
    } finally {
      setSyncing(false)
    }
  }

  // Check for OAuth callback messages
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fitbitConnected = params.get('fitbit_connected')
    const fitbitError = params.get('fitbit_error')
    
    if (fitbitConnected) {
      alert('Fitbit connected successfully!')
      loadConnectedAccounts()
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    
    if (fitbitError) {
      alert(`Fitbit connection error: ${decodeURIComponent(fitbitError)}`)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  const fitbitAccount = connectedAccounts.find(a => a.provider === 'fitbit')
  const fitbitClientId = import.meta.env.VITE_FITBIT_CLIENT_ID

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
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
                    ⚠️ Fitbit Client ID not configured. Please set VITE_FITBIT_CLIENT_ID in your environment variables.
                  </div>
                )}
                <button
                  className={styles.connectBtn}
                  onClick={handleConnectFitbit}
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

        {/* Coming Soon */}
        <div className={styles.comingSoonCard}>
          <h3>More Wearables Coming Soon</h3>
          <div className={styles.comingSoonList}>
            <div className={styles.comingSoonItem}>
              <span>Oura Ring</span>
            </div>
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
    </div>
  )
}

