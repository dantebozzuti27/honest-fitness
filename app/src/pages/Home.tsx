import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase, getRecentWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { getMetricsFromSupabase, saveMetricsToSupabase } from '../lib/db/metricsDb'
import { getFitbitDaily, getMostRecentFitbitData, getAllConnectedAccounts } from '../lib/wearables'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Button from '../components/Button'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import SafeAreaScaffold from '../components/ui/SafeAreaScaffold'
import Card from '../components/ui/Card'
import InputField from '../components/InputField'
import styles from './Home.module.css'

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [streak, setStreak] = useState(0)
  const [recentWorkouts, setRecentWorkouts] = useState<any[]>([])
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

      // Fitbit data
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

  // Refresh on visibility change
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

  const todaysWorkouts = recentWorkouts.filter((w: any) => w?.date === getTodayEST())

  return (
    <SafeAreaScaffold>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Honest Fitness</h1>
        </div>

        <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '100px' }}>
          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button onClick={() => navigate('/today')} style={{ flex: 1 }}>
              Today's Workout
            </Button>
            <Button variant="secondary" onClick={() => navigate('/workout/active', { state: { mode: 'picker', sessionType: 'workout' } })} style={{ flex: 1 }}>
              Manual Workout
            </Button>
          </div>

          {/* Today's Status */}
          <Card>
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>Today</h2>
                {streak > 0 && (
                  <span style={{ fontSize: '14px', color: 'var(--accent)' }}>{streak} day streak</span>
                )}
              </div>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Skeleton style={{ width: '70%', height: 14 }} />
                  <Skeleton style={{ width: '50%', height: 14 }} />
                </div>
              ) : todaysWorkouts.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {todaysWorkouts.map((w: any) => {
                    const mins = Math.floor((w.duration || 0) / 60)
                    const exCount = Array.isArray(w.workout_exercises) ? w.workout_exercises.length : 0
                    return (
                      <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {w.template_name || 'Freestyle Workout'}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                            {exCount} exercises &middot; {mins} min
                          </div>
                        </div>
                        <span style={{ color: 'var(--success)', fontSize: '14px' }}>Done</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>No workout logged today.</p>
              )}
            </div>
          </Card>

          {/* Weight Entry */}
          <Card>
            <div style={{ padding: '16px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--text-primary)' }}>Weight</h2>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <InputField
                    label=""
                    type="number"
                    placeholder={savedWeight ? `Last: ${savedWeight} lbs` : 'Enter weight (lbs)'}
                    value={weight}
                    onChange={(e: any) => setWeight(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={handleSaveWeight}
                  loading={savingWeight}
                  disabled={!weight.trim() || weight === savedWeight}
                  style={{ marginBottom: '2px' }}
                >
                  Save
                </Button>
              </div>
            </div>
          </Card>

          {/* Fitbit Stats */}
          {hasFitbit && (
            <Card>
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>Fitbit</h2>
                  <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Auto-synced</span>
                </div>
                {loading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <Skeleton style={{ width: '60%', height: 14 }} />
                    <Skeleton style={{ width: '80%', height: 14 }} />
                  </div>
                ) : fitbitData ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {fitbitData.steps != null && (
                      <div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {Number(fitbitData.steps).toLocaleString()}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Steps</div>
                      </div>
                    )}
                    {fitbitData.calories_burned != null && (
                      <div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {Number(fitbitData.calories_burned).toLocaleString()}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Calories Burned</div>
                      </div>
                    )}
                    {fitbitData.resting_heart_rate != null && (
                      <div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {fitbitData.resting_heart_rate}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Resting HR</div>
                      </div>
                    )}
                    {fitbitData.sleep_duration != null && (
                      <div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {(fitbitData.sleep_duration / 60).toFixed(1)}h
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Sleep</div>
                      </div>
                    )}
                    {fitbitData.hrv != null && (
                      <div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {fitbitData.hrv}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>HRV</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>No Fitbit data for today yet.</p>
                )}
              </div>
            </Card>
          )}

          {/* Recent Workouts */}
          <Card>
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>Recent Workouts</h2>
                <Button variant="tertiary" onClick={() => navigate('/workout')}>
                  See all
                </Button>
              </div>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <Skeleton style={{ height: 40 }} />
                  <Skeleton style={{ height: 40 }} />
                  <Skeleton style={{ height: 40 }} />
                </div>
              ) : recentWorkouts.length === 0 ? (
                <EmptyState
                  title="No workouts yet"
                  message="Start your first workout to see history here."
                  actionLabel="Start Workout"
                  onAction={() => navigate('/workout/active', { state: { mode: 'picker', sessionType: 'workout' } })}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {recentWorkouts.slice(0, 7).map((w: any) => {
                    const mins = Math.floor((w.duration || 0) / 60)
                    const exCount = Array.isArray(w.workout_exercises) ? w.workout_exercises.length : 0
                    return (
                      <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        <div>
                          <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '14px' }}>
                            {w.template_name || 'Freestyle'}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {exCount} exercises &middot; {mins} min
                          </div>
                        </div>
                        <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{w.date}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* Connect Fitbit CTA */}
          {!hasFitbit && !loading && (
            <Card>
              <div style={{ padding: '16px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                  Connect Fitbit to see steps, sleep, and heart rate data.
                </p>
                <Button variant="secondary" onClick={() => navigate('/profile')}>
                  Connect Fitbit
                </Button>
              </div>
            </Card>
          )}
        </div>

        {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
      </div>
    </SafeAreaScaffold>
  )
}
