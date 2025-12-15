/**
 * Data Freshness Indicator Component
 * Shows when data was last updated with subtle Apple-style badges
 */

import { useState, useEffect } from 'react'
import styles from './DataFreshnessIndicator.module.css'

export default function DataFreshnessIndicator({ 
  lastUpdated, 
  isSyncing = false,
  size = 'small' // 'small' | 'medium' | 'large'
}) {
  const [timeAgo, setTimeAgo] = useState('')

  useEffect(() => {
    if (!lastUpdated) {
      setTimeAgo('')
      return
    }

    const updateTimeAgo = () => {
      const now = new Date()
      const updated = new Date(lastUpdated)
      const diffMs = now - updated
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) {
        setTimeAgo('Just now')
      } else if (diffMins < 60) {
        setTimeAgo(`${diffMins}m ago`)
      } else if (diffHours < 24) {
        setTimeAgo(`${diffHours}h ago`)
      } else if (diffDays < 7) {
        setTimeAgo(`${diffDays}d ago`)
      } else {
        setTimeAgo(updated.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
      }
    }

    updateTimeAgo()
    const interval = setInterval(updateTimeAgo, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [lastUpdated])

  if (!lastUpdated && !isSyncing) {
    return null
  }

  return (
    <div className={`${styles.freshnessIndicator} ${styles[size]}`}>
      {isSyncing ? (
        <>
          <span className={styles.syncIcon}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2" />
            </svg>
          </span>
          <span className={styles.syncText}>Syncing...</span>
        </>
      ) : (
        <>
          <span className={styles.dot} />
          <span className={styles.timeText}>{timeAgo}</span>
        </>
      )}
    </div>
  )
}

