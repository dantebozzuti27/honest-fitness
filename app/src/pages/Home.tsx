import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase, getRecentWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { getMetricsFromSupabase, saveMetricsToSupabase } from '../lib/db/metricsDb'
import { getFitbitDaily, getMostRecentFitbitData, getAllConnectedAccounts } from '../lib/wearables'
import { getTodayEST, getYesterdayEST, getLocalDate } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import Skeleton from '../components/Skeleton'
import Button from '../components/Button'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import SafeAreaScaffold from '../components/ui/SafeAreaScaffold'
import styles from './Home.module.css'

type WorkoutEntry = {
  id: string
  date?: string
  duration?: number
  template_name?: string
  workout_avg_hr?: number | null
  workout_peak_hr?: number | null
  workout_calories_burned?: number | null
  workout_steps?: number | null
  workout_active_minutes?: number | null
  workout_hr_zones?: Record<string, number> | null
  workout_exercises?: Array<{
    exercise_name?: string
    name?: string
    body_part?: string
    workout_sets?: Array<{ weight?: number | string; reps?: number | string }>
  }>
}

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [streak, setStreak] = useState(0)
  const [recentWorkouts, setRecentWorkouts] = useState<WorkoutEntry[]>([])
  const [fitbitData, setFitbitData] = useState<any>(null)
  const [hasFitbit, setHasFitbit] = useState(false)
  const [weight, setWeight] = useState('')
  const [savedWeight, setSavedWeight] = useState<string | null>(null)
  const [savingWeight, setSavingWeight] = useState(false)

  const loadData = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const today = getTodayEST()
      const yesterday = getYesterdayEST()

      const [streakVal, workouts, todayMetrics] = await Promise.all([
        calculateStreakFromSupabase(user.id).catch(() => 0),
        getRecentWorkoutsFromSupabase(user.id, 10).catch(() => []),
        getMetricsFromSupabase(user.id, yesterday, today).catch(() => []),
      ])

      setStreak(streakVal as number)
      setRecentWorkouts(Array.isArray(workouts) ? workouts : [])

      const todayRow = Array.isArray(todayMetrics) ? todayMetrics.find((m: any) => m?.date === today) : null
      if (todayRow?.weight != null) {
        setWeight(String(todayRow.weight))
        setSavedWeight(String(todayRow.weight))
      } else {
        setSavedWeight(null)
      }

      try {
        const connected = await getAllConnectedAccounts(user.id)
        const fitbit = Array.isArray(connected) ? connected.find((a: any) => a.provider === 'fitbit') : null
        setHasFitbit(!!fitbit)
        if (fitbit) {
          const [daily, recent] = await Promise.all([
            getFitbitDaily(user.id, today).catch(() => null),
            getMostRecentFitbitData(user.id).catch(() => null),
          ])
          setFitbitData(daily || recent || null)
        }
      } catch {
        setHasFitbit(false)
      }
    } catch (e) {
      logError('Home load failed', e)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const onVisible = () => { if (!document.hidden) loadData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadData])

  const handleSaveWeight = async () => {
    if (!user?.id || !weight.trim()) return
    const val = parseFloat(weight)
    if (!Number.isFinite(val) || val <= 0 || val > 999) {
      showToast('Enter a valid weight', 'error')
      return
    }
    setSavingWeight(true)
    try {
      const result = await saveMetricsToSupabase(user.id, getTodayEST(), { weight: val }, { allowOutbox: false })
      if (result && typeof result === 'object' && 'queued' in result) {
        showToast('Weight queued — will sync when online', 'error')
        return
      }
      setSavedWeight(String(val))
      showToast('Weight saved', 'success')
      loadData()
    } catch (e) {
      logError('Save weight failed', e)
      showToast('Failed to save weight', 'error')
    } finally {
      setSavingWeight(false)
    }
  }

  const todaysWorkouts = recentWorkouts.filter(w => w?.date === getTodayEST())
  const pastWorkouts = recentWorkouts.filter(w => w?.date !== getTodayEST())

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const getWorkoutVolume = (w: WorkoutEntry) => {
    if (!Array.isArray(w.workout_exercises)) return 0
    return w.workout_exercises.reduce((sum, ex) => {
      const sets = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      return sum + sets.reduce((s, set) => {
        const wt = Number(set?.weight)
        const rp = Number(set?.reps)
        return s + (Number.isFinite(wt) && wt > 0 && Number.isFinite(rp) && rp > 0 ? wt * rp : 0)
      }, 0)
    }, 0)
  }

  const formatVolume = (v: number) => {
    if (v >= 10000) return `${(v / 1000).toFixed(1)}k`
    if (v > 0) return v.toLocaleString()
    return '—'
  }

  return (
    <SafeAreaScaffold>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Honest Fitness</h1>
        </div>

        <div className={styles.content}>
          {/* Hero CTA */}
          <div className={styles.todayHero}>
            <Button unstyled className={styles.heroPrimary} onClick={() => navigate('/today')}>
              <span className={styles.heroPrimaryLabel}>{getGreeting()}</span>
              <span className={styles.heroPrimaryValue}>
                {todaysWorkouts.length > 0 ? 'Workout Complete' : "Today's Workout"}
              </span>
              {todaysWorkouts.length > 0 ? (
                <>
                  {todaysWorkouts.map((w, i) => {
                    const mins = Math.floor((w.duration || 0) / 60)
                    const exCount = Array.isArray(w.workout_exercises) ? w.workout_exercises.length : 0
                    return (
                      <div key={w.id || i}>
                        <span className={styles.heroPrimarySub}>
                          {w.template_name || 'Freestyle'} — {exCount} exercises, {mins} min
                        </span>
                        {(w.workout_calories_burned != null || w.workout_avg_hr != null || w.workout_steps != null) && (
                          <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
                            {w.workout_calories_burned != null && (
                              <span className={styles.heroPrimarySub} style={{ fontSize: '12px' }}>
                                {Math.round(w.workout_calories_burned)} cal
                              </span>
                            )}
                            {w.workout_avg_hr != null && (
                              <span className={styles.heroPrimarySub} style={{ fontSize: '12px' }}>
                                {Math.round(w.workout_avg_hr)} avg HR
                              </span>
                            )}
                            {w.workout_peak_hr != null && (
                              <span className={styles.heroPrimarySub} style={{ fontSize: '12px' }}>
                                {Math.round(w.workout_peak_hr)} peak HR
                              </span>
                            )}
                            {w.workout_steps != null && (
                              <span className={styles.heroPrimarySub} style={{ fontSize: '12px' }}>
                                {w.workout_steps.toLocaleString()} steps
                              </span>
                            )}
                            {w.workout_active_minutes != null && (
                              <span className={styles.heroPrimarySub} style={{ fontSize: '12px' }}>
                                {w.workout_active_minutes} active min
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              ) : (
                <span className={styles.heroPrimarySub}>
                  AI-generated, personalized to your data
                </span>
              )}
              {streak > 0 && (
                <div className={styles.heroMeta}>
                  <span className={styles.heroMetaItem}>{streak} day streak</span>
                </div>
              )}
            </Button>

            <div className={styles.quickGrid}>
              <Button unstyled className={styles.quickCard} onClick={() => navigate('/workout/active', { state: { mode: 'picker', sessionType: 'workout' } })}>
                <span className={styles.quickCardTitle}>Manual Workout</span>
                <span className={styles.quickCardSub}>Freestyle session</span>
              </Button>
              <Button unstyled className={styles.quickCard} onClick={() => navigate('/workout')}>
                <span className={styles.quickCardTitle}>History</span>
                <span className={styles.quickCardSub}>{recentWorkouts.length} recent sessions</span>
              </Button>
              <Button unstyled className={styles.quickCard} onClick={() => navigate('/analytics')}>
                <span className={styles.quickCardTitle}>Analytics</span>
                <span className={styles.quickCardSub}>Trends & intelligence</span>
              </Button>
              <Button unstyled className={styles.quickCard} onClick={() => navigate('/profile')}>
                <span className={styles.quickCardTitle}>Profile</span>
                <span className={styles.quickCardSub}>Goals & preferences</span>
              </Button>
            </div>
          </div>

          {/* Stats Row */}
          <div className={styles.summaryGrid}>
            {/* Streak */}
            <Button unstyled className={styles.summaryCard} onClick={() => navigate('/workout')}>
              {loading ? (
                <Skeleton style={{ width: '60%', height: 28 }} />
              ) : (
                <>
                  <span className={styles.summaryLabel}>Streak</span>
                  <div className={styles.summaryValueRow}>
                    <span className={styles.summaryValue}>{streak}</span>
                    <span className={styles.summaryUnit}>days</span>
                  </div>
                </>
              )}
            </Button>

            {/* Weight */}
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Weight</span>
              {loading ? (
                <Skeleton style={{ width: '60%', height: 28 }} />
              ) : savedWeight ? (
                <div className={styles.summaryValueRow}>
                  <span className={styles.summaryValue}>{savedWeight}</span>
                  <span className={styles.summaryUnit}>lbs</span>
                </div>
              ) : (
                <span className={styles.summaryEmpty}>Not logged</span>
              )}
            </div>

            {/* Fitbit: Steps */}
            {hasFitbit && fitbitData?.steps != null && (
              <Button unstyled className={styles.summaryCard} onClick={() => navigate('/analytics')}>
                <span className={styles.summaryLabel}>Steps</span>
                <div className={styles.summaryValueRow}>
                  <span className={styles.summaryValue}>{Number(fitbitData.steps).toLocaleString()}</span>
                </div>
              </Button>
            )}

            {/* Fitbit: Sleep */}
            {hasFitbit && fitbitData?.sleep_duration != null && (
              <Button unstyled className={styles.summaryCard} onClick={() => navigate('/analytics')}>
                <span className={styles.summaryLabel}>Sleep</span>
                <div className={styles.summaryValueRow}>
                  <span className={styles.summaryValue}>
                    {Math.floor(fitbitData.sleep_duration / 60)}h {Math.round(fitbitData.sleep_duration % 60)}m
                  </span>
                </div>
              </Button>
            )}

            {/* Fitbit: HRV */}
            {hasFitbit && fitbitData?.hrv != null && (
              <Button unstyled className={styles.summaryCard} onClick={() => navigate('/analytics')}>
                <span className={styles.summaryLabel}>HRV</span>
                <div className={styles.summaryValueRow}>
                  <span className={styles.summaryValue}>{Math.round(fitbitData.hrv)}</span>
                  <span className={styles.summaryUnit}>ms</span>
                </div>
              </Button>
            )}

            {/* Fitbit: Resting HR */}
            {hasFitbit && fitbitData?.resting_heart_rate != null && (
              <Button unstyled className={styles.summaryCard} onClick={() => navigate('/analytics')}>
                <span className={styles.summaryLabel}>Resting HR</span>
                <div className={styles.summaryValueRow}>
                  <span className={styles.summaryValue}>{fitbitData.resting_heart_rate}</span>
                  <span className={styles.summaryUnit}>bpm</span>
                </div>
              </Button>
            )}
          </div>

          {/* #37: Streak Calendar — last 28 days */}
          {!loading && recentWorkouts.length > 0 && (() => {
            const today = new Date()
            const workoutDates = new Set(recentWorkouts.map(w => w.date).filter(Boolean))
            const days: { date: string; dayNum: number; hasWorkout: boolean; isToday: boolean }[] = []
            for (let i = 27; i >= 0; i--) {
              const d = new Date(today)
              d.setDate(d.getDate() - i)
              const dateStr = getLocalDate(d)
              days.push({
                date: dateStr,
                dayNum: d.getDate(),
                hasWorkout: workoutDates.has(dateStr),
                isToday: i === 0,
              })
            }
            return (
              <div className={styles.streakCalendar}>
                <div className={styles.streakCalendarTitle}>Last 28 Days</div>
                <div className={styles.streakGrid}>
                  {days.map(d => (
                    <div
                      key={d.date}
                      className={`${styles.streakCell} ${d.hasWorkout ? styles.streakCellActive : ''} ${d.isToday ? styles.streakCellToday : ''}`}
                      title={d.date}
                    >
                      {d.dayNum}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Weight Entry (only if not yet saved today) */}
          {!savedWeight && !loading && (
            <div className={styles.primaryCtaCard}>
              <div className={styles.primaryCtaTop}>
                <span className={styles.summaryLabel}>Log Today's Weight</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Weight (lbs)"
                  value={weight}
                  onChange={e => setWeight(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: '16px',
                    fontFamily: 'inherit',
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={handleSaveWeight}
                  loading={savingWeight}
                  disabled={!weight.trim()}
                  style={{ padding: '12px 20px', flexShrink: 0 }}
                >
                  Save
                </Button>
              </div>
            </div>
          )}

          {/* Connect Fitbit */}
          {!hasFitbit && !loading && (
            <Button unstyled className={styles.quickCard} onClick={() => navigate('/profile')} style={{ padding: '16px', textAlign: 'center' }}>
              <span className={styles.quickCardTitle}>Connect Fitbit</span>
              <span className={styles.quickCardSub}>See steps, sleep, heart rate & HRV</span>
            </Button>
          )}

          {/* Recent Workouts */}
          <div className={styles.previewCard}>
            <div className={styles.previewTop}>
              <span className={styles.previewTitle}>Recent Sessions</span>
              <Button unstyled className={styles.previewLink} onClick={() => navigate('/workout')}>
                See all
              </Button>
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Skeleton style={{ height: 52 }} />
                <Skeleton style={{ height: 52 }} />
                <Skeleton style={{ height: 52 }} />
              </div>
            ) : recentWorkouts.length === 0 ? (
              <div className={styles.previewEmpty}>
                No workouts yet. Start your first session to see history here.
              </div>
            ) : (
              <div className={styles.previewBody}>
                {(todaysWorkouts.length > 0 ? recentWorkouts : pastWorkouts).slice(0, 5).map(w => {
                  const mins = Math.floor((w.duration || 0) / 60)
                  const exCount = Array.isArray(w.workout_exercises) ? w.workout_exercises.length : 0
                  const vol = getWorkoutVolume(w)
                  const bodyParts = [...new Set(
                    (w.workout_exercises || []).map(e => e.body_part).filter(Boolean)
                  )].slice(0, 3)
                  const isToday = w.date === getTodayEST()

                  return (
                    <div key={w.id} className={styles.previewLine}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className={styles.previewLabel}>
                          {isToday ? 'Today' : w.date}
                        </span>
                        <span className={styles.previewLabel}>{mins}m</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className={styles.previewValue}>
                          {w.template_name || 'Freestyle'}
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {exCount} ex · {formatVolume(vol)} lbs
                        </span>
                      </div>
                      {(w.workout_calories_burned != null || w.workout_avg_hr != null) && (
                        <div style={{ display: 'flex', gap: '10px', marginTop: '3px' }}>
                          {w.workout_calories_burned != null && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{Math.round(w.workout_calories_burned)} cal</span>
                          )}
                          {w.workout_avg_hr != null && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{Math.round(w.workout_avg_hr)} avg HR</span>
                          )}
                          {w.workout_peak_hr != null && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{Math.round(w.workout_peak_hr)} peak</span>
                          )}
                          {w.workout_steps != null && w.workout_steps > 0 && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{w.workout_steps.toLocaleString()} steps</span>
                          )}
                        </div>
                      )}
                      {bodyParts.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                          {bodyParts.map((bp, i) => (
                            <span key={i} style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.08)',
                              color: 'var(--text-tertiary)',
                              textTransform: 'capitalize',
                            }}>
                              {bp}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
      </div>
    </SafeAreaScaffold>
  )
}
