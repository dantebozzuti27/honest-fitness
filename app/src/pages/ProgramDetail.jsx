import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BackButton from '../components/BackButton'
import Button from '../components/Button'
import Skeleton from '../components/Skeleton'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import { logError } from '../utils/logger'
import { claimFreeProgram, getCoachProfile, getMyPurchaseForProgram, getProgramById } from '../lib/db/marketplaceDb'
import styles from './ProgramDetail.module.css'

function formatPrice({ priceCents, currency }) {
  const cents = Number(priceCents || 0)
  if (cents <= 0) return 'Free'
  const dollars = cents / 100
  const curr = String(currency || 'usd').toUpperCase()
  return `${curr} $${dollars.toFixed(2)}`
}

export default function ProgramDetail() {
  const { programId } = useParams()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [program, setProgram] = useState(null)
  const [coach, setCoach] = useState(null)
  const [purchase, setPurchase] = useState(null)
  const [claiming, setClaiming] = useState(false)

  const isOwner = Boolean(user?.id && program?.coachId && user.id === program.coachId)
  const hasAccess = isOwner || purchase?.status === 'paid'

  const workoutTemplateCount = useMemo(() => {
    const list = program?.content?.workoutTemplates
    return Array.isArray(list) ? list.length : 0
  }, [program])

  const nutrition = program?.content?.nutrition || null
  const health = program?.content?.health || null

  useEffect(() => {
    let mounted = true
    setLoading(true)
    ;(async () => {
      try {
        const p = await getProgramById(programId)
        if (!mounted) return
        setProgram(p)
        if (p?.coachId) {
          getCoachProfile(p.coachId).then(setCoach).catch(() => {})
        }
        if (user?.id && p?.id) {
          getMyPurchaseForProgram(user.id, p.id).then(setPurchase).catch(() => {})
        }
      } catch (e) {
        logError('Program detail load failed', e)
        showToast('Failed to load program.', 'error')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [programId, user?.id, showToast])

  const onClaim = async () => {
    if (!user?.id || !program) return
    setClaiming(true)
    try {
      const result = await claimFreeProgram(user.id, program)
      setPurchase(result)
      showToast('Added to your library.', 'success')
    } catch (e) {
      if (e?.code === 'PAYMENTS_NOT_ENABLED') {
        showToast('Paid checkout is coming soon. Set price to $0 for now to test.', 'error', 6000)
      } else {
        showToast('Could not claim this program. Please try again.', 'error')
      }
    } finally {
      setClaiming(false)
    }
  }

  const onApply = async () => {
    if (!program) return
    try {
      const db = await import('../db/lazyDb')
      const bulkAddTemplates = db.bulkAddTemplates
      if (typeof bulkAddTemplates !== 'function') {
        showToast('Template storage is not available yet in this build.', 'error')
        return
      }
      const templates = Array.isArray(program.content?.workoutTemplates) ? program.content.workoutTemplates : []
      if (templates.length === 0) {
        showToast('This program has no workout templates to apply.', 'error')
        return
      }

      const safeTemplates = templates.map((t, idx) => {
        const baseId = t?.id ? String(t.id) : `t${idx + 1}`
        return {
          id: `mp_${program.id}_${baseId}`,
          name: t?.name || `Template ${idx + 1}`,
          exercises: Array.isArray(t?.exercises) ? t.exercises : []
        }
      })

      await bulkAddTemplates(safeTemplates)
      showToast('Applied! Templates are now in your Planner/Workout flow.', 'success', 4500)
    } catch (e) {
      logError('Apply program failed', e)
      showToast('Failed to apply program. Please try again.', 'error')
    }
  }

  return (
    <div className={styles.container}>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={hideToast}
        />
      )}

      <div className={styles.headerRow}>
        <BackButton fallbackPath="/market" />
        <h1 className={styles.title}>Program</h1>
        <div style={{ width: 32 }} />
      </div>

      {loading ? (
        <>
          <Skeleton style={{ width: '100%', height: 120, marginBottom: 12 }} />
          <Skeleton style={{ width: '100%', height: 160, marginBottom: 12 }} />
          <Skeleton style={{ width: '100%', height: 120 }} />
        </>
      ) : !program ? (
        <div className={styles.card}>
          <div className={styles.meta}>Program not found.</div>
        </div>
      ) : (
        <>
          <div className={styles.card}>
            <div className={styles.h2}>{program.title}</div>
            <div className={styles.meta}>
              {(coach?.displayName || 'Coach')} · {formatPrice({ priceCents: program.priceCents, currency: program.currency })}
              {isOwner ? ' · Yours' : ''}
              {hasAccess ? ' · In library' : ''}
            </div>
            {program.description ? <div className={styles.desc}>{program.description}</div> : null}

            <div style={{ marginTop: 12 }} className={styles.btnRow}>
              {hasAccess ? (
                <Button className={styles.btn} onClick={onApply}>
                  Apply program
                </Button>
              ) : (
                <Button
                  className={styles.btn}
                  onClick={onClaim}
                  loading={claiming}
                  disabled={!user?.id || claiming}
                >
                  {program.priceCents > 0 ? 'Checkout (coming soon)' : 'Get free'}
                </Button>
              )}
              <Button
                className={styles.btn}
                variant="secondary"
                onClick={() => {
                  try {
                    navigator.share?.({ title: program.title, text: program.description || '', url: window.location.href })
                  } catch {
                    // no-op
                  }
                }}
              >
                Share
              </Button>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.row}>
              <div className={styles.h2} style={{ marginBottom: 0 }}>What’s inside</div>
              <span className={styles.pill}>{workoutTemplateCount} workout templates</span>
            </div>
            <div className={styles.grid} style={{ marginTop: 10 }}>
              {workoutTemplateCount > 0 ? (
                <ul className={styles.list}>
                  {(program.content?.workoutTemplates || []).slice(0, 8).map((t) => (
                    <li key={t.id || t.name}>{t.name || 'Template'}</li>
                  ))}
                  {workoutTemplateCount > 8 ? <li>…and more</li> : null}
                </ul>
              ) : (
                <div className={styles.meta}>No workout templates provided yet.</div>
              )}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.h2}>Nutrition</div>
            {nutrition ? (
              <div className={styles.desc}>
                {nutrition.caloriesTarget ? `Calories: ${nutrition.caloriesTarget}\n` : '' }
                {nutrition.proteinG ? `Protein: ${nutrition.proteinG}g\n` : '' }
                {nutrition.carbsG ? `Carbs: ${nutrition.carbsG}g\n` : '' }
                {nutrition.fatG ? `Fat: ${nutrition.fatG}g\n` : '' }
                {nutrition.notes ? `\n${nutrition.notes}` : '—'}
              </div>
            ) : (
              <div className={styles.meta}>—</div>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.h2}>Health</div>
            {health ? (
              <div className={styles.desc}>
                {health.sleepHoursTarget ? `Sleep: ${health.sleepHoursTarget}h\n` : '' }
                {health.stepsTarget ? `Steps: ${health.stepsTarget}\n` : '' }
                {health.habits ? `\n${health.habits}` : '—'}
              </div>
            ) : (
              <div className={styles.meta}>—</div>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.h2}>Coach notes</div>
            <div className={styles.desc}>{program.content?.notes || '—'}</div>
          </div>
        </>
      )}
    </div>
  )
}


