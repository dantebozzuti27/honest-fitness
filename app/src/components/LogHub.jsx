import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../hooks/useToast'
import Toast from './Toast'
import Button from './Button'
import SideMenu from './SideMenu'
import BackButton from './BackButton'
import { flushOutbox, getOutboxPendingCount } from '../lib/syncOutbox'
import { setLastQuickAction } from '../utils/quickActions'
import { getDefaultMealType, openHealthLog, openMealLog, startWorkout } from '../utils/navIntents'
import SafeAreaScaffold from './ui/SafeAreaScaffold'
import styles from './LogHub.module.css'

export default function LogHub() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [hasActiveWorkout, setHasActiveWorkout] = useState(false)
  const [checkingActive, setCheckingActive] = useState(false)

  useEffect(() => {
    const refresh = () => setPendingSyncCount(getOutboxPendingCount(user?.id))
    refresh()
    window.addEventListener('outboxUpdated', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('outboxUpdated', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    setCheckingActive(true)
    setHasActiveWorkout(false)

    import('../lib/db/workoutsSessionDb')
      .then(async ({ getActiveWorkoutSession }) => {
        const session = await getActiveWorkoutSession(user.id)
        if (cancelled) return
        const has = Boolean(session && (Array.isArray(session.exercises) ? session.exercises.length > 0 : true))
        setHasActiveWorkout(has)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCheckingActive(false)
      })

    return () => { cancelled = true }
  }, [user?.id])

  const mealType = useMemo(() => getDefaultMealType(), [])

  const actions = useMemo(() => ([
    {
      id: 'meal',
      title: 'Log meal',
      subtitle: `Quick add (${mealType})`,
      onClick: () => {
        setLastQuickAction({ type: 'meal', mealType })
        openMealLog(navigate, { mealType })
      }
    },
    ...(hasActiveWorkout
      ? [{
          id: 'continue',
          title: 'Continue workout',
          subtitle: 'Resume where you left off',
          onClick: () => {
            setLastQuickAction({ type: 'continue_workout' })
            startWorkout(navigate, { mode: 'resume' })
          }
        }]
      : []),
    {
      id: 'workout',
      title: 'Start workout',
      subtitle: 'Open the exercise picker',
      onClick: () => {
        setLastQuickAction({ type: 'start_workout', sessionType: 'workout' })
        startWorkout(navigate, { mode: 'picker', sessionType: 'workout' })
      }
    },
    {
      id: 'recovery',
      title: 'Start recovery',
      subtitle: 'Sauna, cold plunge, mobility, breathwork',
      onClick: () => {
        setLastQuickAction({ type: 'start_workout', sessionType: 'recovery' })
        startWorkout(navigate, { mode: 'picker', sessionType: 'recovery' })
      }
    },
    {
      id: 'metrics',
      title: 'Log metrics',
      subtitle: 'Weight, sleep, readiness, etc.',
      onClick: () => {
        openHealthLog(navigate)
      }
    }
  ]), [hasActiveWorkout, mealType, navigate])

  const handleSyncNow = async () => {
    if (!user?.id) return
    const before = getOutboxPendingCount(user.id)
    if (before === 0) {
      showToast('Nothing to sync right now', 'info')
      return
    }
    showToast('Syncing…', 'info')
    try {
      await flushOutbox(user.id)
      const after = getOutboxPendingCount(user.id)
      if (after === 0) {
        showToast('All synced', 'success')
      } else {
        showToast(`Still pending: ${after}`, 'info')
      }
    } catch (e) {
      showToast('Sync failed — will retry when online', 'error')
    }
  }

  const Header = () => (
    <header className={styles.pageHeader}>
      <SideMenu />
      <h1 className={styles.pageTitle}>Log</h1>
      <BackButton />
    </header>
  )

  return (
    <SafeAreaScaffold>
      <div className={styles.pageContainer}>
        <Header />

        {pendingSyncCount > 0 && (
          <div className={styles.syncRow} aria-label={`${pendingSyncCount} items pending sync`}>
            <div className={styles.syncText}>Pending sync: {pendingSyncCount}</div>
            <Button variant="secondary" size="sm" onClick={handleSyncNow}>
              Sync now
            </Button>
          </div>
        )}

        <div className={styles.grid}>
          {actions.map((c) => (
            <button key={c.id} className={styles.card} onClick={c.onClick} type="button">
              <div className={styles.cardTitle}>{c.title}</div>
              <div className={styles.cardSubtitle}>{c.subtitle}</div>
            </button>
          ))}
        </div>

        {checkingActive ? <div className={styles.sheetHint}>Checking for an active workout…</div> : null}

        {toast && (
          <div className={styles.toastWrap}>
            <Toast message={toast.message} type={toast.type} onClose={hideToast} />
          </div>
        )}
      </div>
    </SafeAreaScaffold>
  )
}


