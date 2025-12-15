import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../hooks/useToast'
import { flushOutbox, getOutboxPendingCount } from '../lib/syncOutbox'
import SideMenu from '../components/SideMenu'
import BackButton from '../components/BackButton'
import Toast from '../components/Toast'
import Button from '../components/Button'
import styles from './Log.module.css'

export default function Log() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [pendingSyncCount, setPendingSyncCount] = useState(0)

  useEffect(() => {
    const refresh = () => setPendingSyncCount(getOutboxPendingCount())
    refresh()
    window.addEventListener('outboxUpdated', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('outboxUpdated', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [])

  const cards = useMemo(() => ([
    {
      id: 'workout',
      title: 'Start workout',
      subtitle: 'Log a training session',
      onClick: () => navigate('/workout/active', { state: { sessionType: 'workout' } })
    },
    {
      id: 'recovery',
      title: 'Start recovery',
      subtitle: 'Sauna, cold plunge, mobility, breathwork',
      onClick: () => navigate('/workout/active', { state: { sessionType: 'recovery' } })
    },
    {
      id: 'meal',
      title: 'Log meal',
      subtitle: 'Add a meal to nutrition',
      onClick: () => navigate('/nutrition', { state: { openMealModal: true } })
    },
    {
      id: 'metrics',
      title: 'Log metrics',
      subtitle: 'Weight, sleep, readiness, etc.',
      onClick: () => navigate('/health', { state: { openLogModal: true } })
    }
  ]), [navigate])

  const handleSyncNow = async () => {
    if (!user) return
    const before = getOutboxPendingCount()
    if (before === 0) {
      showToast('Nothing to sync right now', 'info')
      return
    }
    showToast('Syncing…', 'info')
    try {
      await flushOutbox()
      const after = getOutboxPendingCount()
      if (after === 0) {
        showToast('All synced', 'success')
      } else {
        showToast(`Still pending: ${after}`, 'info')
      }
    } catch (e) {
      showToast('Sync failed — will retry when online', 'error')
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <SideMenu />
        <h1 className={styles.title}>Log</h1>
        <BackButton />
      </header>

      {pendingSyncCount > 0 && (
        <div className={styles.syncRow}>
          <div className={styles.syncText}>Pending sync: {pendingSyncCount}</div>
          <Button variant="secondary" size="sm" onClick={handleSyncNow}>
            Sync now
          </Button>
        </div>
      )}

      <div className={styles.grid}>
        {cards.map((c) => (
          <button key={c.id} className={styles.card} onClick={c.onClick}>
            <div className={styles.cardTitle}>{c.title}</div>
            <div className={styles.cardSubtitle}>{c.subtitle}</div>
          </button>
        ))}
      </div>

      {toast && (
        <div className={styles.toastWrap}>
          <Toast message={toast.message} type={toast.type} onClose={hideToast} />
        </div>
      )}
    </div>
  )
}


