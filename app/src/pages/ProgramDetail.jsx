import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BackButton from '../components/BackButton'
import Button from '../components/Button'
import InputField from '../components/InputField'
import Skeleton from '../components/Skeleton'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import { logError } from '../utils/logger'
import { claimFreeProgram, getCoachProfile, getMyPurchaseForProgram, getProgramById } from '../lib/db/marketplaceDb'
import { scheduleWorkoutSupabase } from '../lib/db/scheduledWorkoutsDb'
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
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrollStartDate, setEnrollStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [enrolling, setEnrolling] = useState(false)

  const isOwner = Boolean(user?.id && program?.coachId && user.id === program.coachId)
  const hasAccess = isOwner || purchase?.status === 'paid'

  const workoutTemplateCount = useMemo(() => {
    const list = program?.content?.workoutTemplates
    return Array.isArray(list) ? list.length : 0
  }, [program])

  const nutrition = program?.content?.nutrition || null
  const health = program?.content?.health || null
  const dayPlans = Array.isArray(program?.content?.dayPlans) ? program.content.dayPlans : []

  const templatesById = useMemo(() => {
    const list = Array.isArray(program?.content?.workoutTemplates) ? program.content.workoutTemplates : []
    const map = {}
    for (const t of list) {
      if (t?.id) map[String(t.id)] = t
    }
    return map
  }, [program])

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

      const safeTemplates = templates.map((t, idx) => toLocalTemplate(program, t, idx))

      await bulkAddTemplates(safeTemplates)
      showToast('Applied! Templates are now in your Planner/Workout flow.', 'success', 4500)
    } catch (e) {
      logError('Apply program failed', e)
      showToast('Failed to apply program. Please try again.', 'error')
    }
  }

  function toLocalTemplate(programObj, t, idx) {
    const baseId = t?.id ? String(t.id) : `t${idx + 1}`
    return {
      id: `mp_${programObj.id}_${baseId}`,
      name: t?.name || `Template ${idx + 1}`,
      exercises: Array.isArray(t?.exercises) ? t.exercises : []
    }
  }

  function localTemplateIdForProgramTemplate(programObj, programTemplateId) {
    if (!programTemplateId) return null
    return `mp_${programObj.id}_${String(programTemplateId)}`
  }

  const onEnroll = async () => {
    if (!user?.id || !program) return
    if (!enrollStartDate) {
      showToast('Pick a start date.', 'error')
      return
    }
    setEnrolling(true)
    try {
      // 1) Ensure templates are applied locally (Calendar maps scheduled template_id to local templates)
      const db = await import('../db/lazyDb')
      const bulkAddTemplates = db.bulkAddTemplates
      if (typeof bulkAddTemplates === 'function') {
        const templates = Array.isArray(program.content?.workoutTemplates) ? program.content.workoutTemplates : []
        const safeTemplates = templates.map((t, idx) => toLocalTemplate(program, t, idx))
        if (safeTemplates.length) await bulkAddTemplates(safeTemplates)
      }

      // 2) Schedule workouts per day plan into Supabase scheduled_workouts
      const start = new Date(`${enrollStartDate}T00:00:00`)
      const days = Array.isArray(program.content?.dayPlans) ? program.content.dayPlans : []
      let scheduledCount = 0

      for (let i = 0; i < days.length; i++) {
        const d = days[i]
        const dayOffset = Math.max(0, Number(d?.dayNumber || (i + 1)) - 1)
        const date = new Date(start.getTime() + dayOffset * 86400000)
        const dateStr = date.toISOString().slice(0, 10)
        const programTemplateId = d?.workout?.templateId
        if (!programTemplateId) continue
        const localTemplateId = localTemplateIdForProgramTemplate(program, programTemplateId)
        if (!localTemplateId) continue
        await scheduleWorkoutSupabase(user.id, dateStr, localTemplateId)
        scheduledCount++
      }

      // 3) Store enrollment metadata locally (for future: show enrollment on UI)
      try {
        localStorage.setItem(
          `program_enroll_${user.id}_${program.id}`,
          JSON.stringify({ startDate: enrollStartDate, scheduledCount, enrolledAt: new Date().toISOString() })
        )
      } catch {
        // ignore
      }

      showToast(`Enrolled! Scheduled ${scheduledCount} workouts on your calendar.`, 'success', 5500)
      setEnrollOpen(false)
    } catch (e) {
      logError('Enroll failed', e)
      showToast('Failed to enroll/schedule. Make sure the new `scheduled_workouts` table exists and try again.', 'error', 6500)
    } finally {
      setEnrolling(false)
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
                <>
                  <Button className={styles.btn} onClick={onApply}>
                    Apply program
                  </Button>
                  <Button className={styles.btn} variant="secondary" onClick={() => setEnrollOpen(true)}>
                    Enroll / Schedule
                  </Button>
                </>
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

          <div className={styles.card}>
            <div className={styles.row}>
              <div className={styles.h2} style={{ marginBottom: 0 }}>Day-by-day plan</div>
              <span className={styles.pill}>{dayPlans.length} days</span>
            </div>

            {dayPlans.length === 0 ? (
              <div className={styles.meta} style={{ marginTop: 10 }}>No day plan provided.</div>
            ) : (
              <div style={{ marginTop: 10 }}>
                {dayPlans.map((d) => {
                  const tpl = d?.workout?.templateId ? templatesById[String(d.workout.templateId)] : null
                  const steps = Array.isArray(d?.workout?.steps) ? d.workout.steps : []
                  const meals = Array.isArray(d?.meals) ? d.meals : []
                  const metrics = Array.isArray(d?.healthMetrics) ? d.healthMetrics : []
                  return (
                    <div key={d.id || `${d.dayNumber}-${d.title}`} className={styles.dayCard}>
                      <div className={styles.dayHeader}>
                        <div className={styles.dayTitle}>
                          Day {d?.dayNumber || ''}{d?.title ? ` — ${d.title}` : ''}
                        </div>
                        <div className={styles.chips}>
                          {tpl?.name ? <span className={styles.pill}>Workout: {tpl.name}</span> : null}
                          {meals.length ? <span className={styles.pill}>{meals.length} meals</span> : null}
                          {metrics.length ? <span className={styles.pill}>{metrics.length} metrics</span> : null}
                        </div>
                      </div>

                      {d?.notes ? <div className={styles.miniMeta}>{d.notes}</div> : null}

                      <div className={styles.subTitle}>Workout</div>
                      <div className={styles.miniMeta}>
                        {d?.workout?.title ? `${d.workout.title}\n` : ''}
                        {tpl?.name ? `Template: ${tpl.name}\n` : ''}
                        {d?.workout?.notes ? `\n${d.workout.notes}` : (tpl || d?.workout?.title ? '' : '—')}
                      </div>
                      {steps.length ? (
                        <ul className={styles.list}>
                          {steps.map((s, i) => (
                            <li key={i}>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{s?.title || `Step ${i + 1}`}</div>
                              {s?.notes ? <div className={styles.miniMeta}>{s.notes}</div> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <div className={styles.subTitle}>Meals</div>
                      {meals.length === 0 ? (
                        <div className={styles.miniMeta}>—</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {meals.map((m, mi) => {
                            const items = Array.isArray(m?.items) ? m.items : []
                            const targets = m?.targets || {}
                            return (
                              <div key={mi}>
                                <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                                  {m?.name || `Meal ${mi + 1}`}{m?.time ? ` · ${m.time}` : ''}
                                </div>
                                {(targets?.calories || targets?.proteinG || targets?.carbsG || targets?.fatG) ? (
                                  <div className={styles.miniMeta}>
                                    {targets?.calories ? `Calories: ${targets.calories}\n` : ''}
                                    {targets?.proteinG ? `Protein: ${targets.proteinG}g\n` : ''}
                                    {targets?.carbsG ? `Carbs: ${targets.carbsG}g\n` : ''}
                                    {targets?.fatG ? `Fat: ${targets.fatG}g` : ''}
                                  </div>
                                ) : null}
                                {m?.notes ? <div className={styles.miniMeta}>{m.notes}</div> : null}
                                {items.length ? (
                                  <ul className={styles.list}>
                                    {items.map((it, ii) => (
                                      <li key={ii}>
                                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                          {it?.food || 'Food'}{it?.grams ? ` · ${it.grams}g` : ''}
                                        </div>
                                        {(it?.calories || it?.proteinG || it?.carbsG || it?.fatG) ? (
                                          <div className={styles.miniMeta}>
                                            {it?.calories ? `Calories: ${it.calories}\n` : ''}
                                            {it?.proteinG ? `Protein: ${it.proteinG}g\n` : ''}
                                            {it?.carbsG ? `Carbs: ${it.carbsG}g\n` : ''}
                                            {it?.fatG ? `Fat: ${it.fatG}g` : ''}
                                          </div>
                                        ) : null}
                                        {it?.notes ? <div className={styles.miniMeta}>{it.notes}</div> : null}
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <div className={styles.subTitle}>Health metrics</div>
                      {metrics.length === 0 ? (
                        <div className={styles.miniMeta}>—</div>
                      ) : (
                        <ul className={styles.list}>
                          {metrics.map((m, i) => (
                            <li key={i}>
                              <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                                {m?.name || 'Metric'}{m?.target ? `: ${m.target}` : ''}{m?.unit ? ` ${m.unit}` : ''}
                              </div>
                              {m?.notes ? <div className={styles.miniMeta}>{m.notes}</div> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      {d?.healthNotes ? (
                        <div className={styles.miniMeta} style={{ marginTop: 8 }}>
                          {d.healthNotes}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {enrollOpen && program ? (
        <div className={styles.modalOverlay} onMouseDown={() => setEnrollOpen(false)} role="dialog" aria-modal="true" aria-label="Enroll program">
          <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Enroll / Schedule</h2>
              <Button unstyled onClick={() => setEnrollOpen(false)}>✕</Button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.meta}>
                Pick a start date. We’ll schedule each day’s workout to your Calendar and keep all the notes in this program.
              </div>
              <InputField
                label="Start date"
                type="date"
                value={enrollStartDate}
                onChange={(e) => setEnrollStartDate(e.target.value)}
              />
              <div className={styles.meta}>
                Note: this schedules workouts only (meals/health targets are displayed in the program detail for now).
              </div>
            </div>
            <div className={styles.modalFooter}>
              <Button className={styles.modalBtn} variant="secondary" onClick={() => setEnrollOpen(false)} disabled={enrolling}>
                Cancel
              </Button>
              <Button className={styles.modalBtn} onClick={onEnroll} loading={enrolling} disabled={enrolling || !user?.id}>
                Enroll & schedule
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}


