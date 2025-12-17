import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Modal from './Modal'
import Button from './Button'
import { setLastQuickAction } from '../utils/quickActions'
import styles from './QuickActionsModal.module.css'

function getDefaultMealType() {
  // Simple local-time heuristic
  const hour = new Date().getHours()
  if (hour < 11) return 'Breakfast'
  if (hour < 15) return 'Lunch'
  if (hour < 21) return 'Dinner'
  return 'Snacks'
}

export default function QuickActionsModal({ isOpen, onClose, pendingSyncCount = 0 }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [hasActiveWorkout, setHasActiveWorkout] = useState(false)
  const [checkingActive, setCheckingActive] = useState(false)
  const closeBtnRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
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

    return () => {
      cancelled = true
    }
  }, [isOpen, user?.id])

  const actions = useMemo(() => {
    const mealType = getDefaultMealType()
    return [
      {
        id: 'meal',
        title: 'Log meal',
        subtitle: `Quick add (${mealType})`,
        onClick: () => {
          setLastQuickAction({ type: 'meal', mealType })
          onClose?.()
          navigate('/nutrition', { state: { openMealModal: true, mealType } })
        }
      },
      hasActiveWorkout
        ? {
            id: 'continue',
            title: 'Continue workout',
            subtitle: 'Resume where you left off',
            onClick: () => {
              setLastQuickAction({ type: 'continue_workout' })
              onClose?.()
              navigate('/workout/active')
            }
          }
        : {
            id: 'workout',
            title: 'Start workout',
            subtitle: 'Jump straight into adding exercises',
            onClick: () => {
              setLastQuickAction({ type: 'start_workout', sessionType: 'workout' })
              onClose?.()
              navigate('/workout/active', { state: { sessionType: 'workout', openPicker: true } })
            }
          },
      {
        id: 'recovery',
        title: 'Start recovery',
        subtitle: 'Sauna, cold plunge, mobility, breathwork',
        onClick: () => {
          setLastQuickAction({ type: 'start_workout', sessionType: 'recovery' })
          onClose?.()
          navigate('/workout/active', { state: { sessionType: 'recovery', openPicker: true } })
        }
      },
      {
        id: 'more',
        title: 'More logging',
        subtitle: 'Workouts, meals, metrics, sync tools',
        onClick: () => {
          onClose?.()
          navigate('/log')
        }
      }
    ]
  }, [hasActiveWorkout, navigate, onClose])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Quick actions"
      initialFocusRef={closeBtnRef}
      modalClassName={styles.modal}
      overlayClassName={styles.overlay}
    >
      <div className={styles.header}>
        <div className={styles.title}>Quick actions</div>
        <button ref={closeBtnRef} className={styles.closeBtn} onClick={() => onClose?.()} aria-label="Close">
          ✕
        </button>
      </div>

      {pendingSyncCount > 0 && (
        <div className={styles.syncRow} aria-label={`${pendingSyncCount} items pending sync`}>
          <div className={styles.syncDot} />
          <div className={styles.syncText}>Pending sync: {pendingSyncCount}</div>
        </div>
      )}

      <div className={styles.list}>
        {actions.map((a) => (
          <button key={a.id} className={styles.actionCard} onClick={a.onClick}>
            <div className={styles.actionTitle}>{a.title}</div>
            <div className={styles.actionSubtitle}>{a.subtitle}</div>
          </button>
        ))}
      </div>

      {checkingActive ? (
        <div className={styles.footerHint}>Checking for an active workout…</div>
      ) : (
        <div className={styles.footerHint}>Tip: this is the fastest way to log meals + workouts.</div>
      )}

      <div className={styles.footerButtons}>
        <Button variant="secondary" onClick={() => onClose?.()}>
          Close
        </Button>
      </div>
    </Modal>
  )
}


