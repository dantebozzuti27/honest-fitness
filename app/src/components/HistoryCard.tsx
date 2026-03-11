/**
 * History Card Component
 * Expandable workout card with exercise-level detail
 */

import { useState } from 'react'
import { formatDateShort, getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import Card from './ui/Card'
import styles from './HistoryCard.module.css'

export type HistoryCardType = 'fitness' | 'health'

export type HistoryCardProps = {
  type?: HistoryCardType
  date?: string
  data: Record<string, any>
  previousData?: Record<string, any> | null
  index?: number
  onView?: () => void
  onDelete?: () => void | Promise<void>
  onEdit?: () => void
}

type ExerciseEntry = {
  exercise_name?: string
  name?: string
  body_part?: string
  category?: string
  workout_sets?: Array<{
    weight?: number | string
    reps?: number | string
    time?: number | string
    is_bodyweight?: boolean
    weight_label?: string
  }>
}

export default function HistoryCard({
  type = 'fitness',
  date,
  data,
  onView,
  onDelete,
  onEdit,
  previousData = null,
  index = 0
}: HistoryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return ''
    const today = getTodayEST()
    const yesterday = getYesterdayEST()

    if (dateStr === today) return 'Today'
    if (dateStr === yesterday) return 'Yesterday'

    const d = new Date(dateStr + 'T12:00:00')
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
    const formatted = formatDateShort(dateStr)
    return `${weekday} \u2022 ${formatted}`
  }

  const getTrend = (current: any, previous: any, format: (v: any) => any = (v) => v) => {
    if (!previous || current == null || previous == null) return null
    const diff = current - previous
    if (Math.abs(diff) < 0.01) return { direction: '\u2192', value: 'Same', color: 'var(--text-secondary)' }
    const isPositive = diff > 0
    return {
      direction: isPositive ? '\u2191' : '\u2193',
      value: `${isPositive ? '+' : ''}${format(Math.abs(diff))}`,
      color: isPositive ? 'var(--success)' : 'var(--danger)'
    }
  }

  const renderFitnessCard = () => {
    const duration = data.duration || 0
    const durationMinutes = Math.floor(duration / 60)
    const durationSeconds = duration % 60
    const durationFormatted = `${durationMinutes}:${String(durationSeconds).padStart(2, '0')}`
    const exercises: ExerciseEntry[] = Array.isArray(data.workout_exercises) ? data.workout_exercises : []
    const exerciseCount = exercises.length
    const sessionType = (data.session_type || data.sessionType || 'workout').toString().toLowerCase()
    const isRecovery = sessionType === 'recovery'
    const templateName = isRecovery ? 'Recovery Session' : (data.template_name || 'Freestyle')

    const totalVolume = exercises.reduce((sum, ex) => {
      const sets = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      return sum + sets.reduce((setSum, set) => {
        const w = Number(set?.weight)
        const r = Number(set?.reps)
        return setSum + (Number.isFinite(w) && w > 0 && Number.isFinite(r) && r > 0 ? w * r : 0)
      }, 0)
    }, 0)

    const totalSets = exercises.reduce((sum, ex) => {
      return sum + (Array.isArray(ex.workout_sets) ? ex.workout_sets.length : 0)
    }, 0)

    const bodyParts: string[] = [...new Set<string>(
      exercises.map(ex => ex.body_part || '').filter(Boolean) as string[]
    )].slice(0, 4)

    const durationTrend = previousData?.duration
      ? getTrend(duration, previousData.duration, (v) => `${Math.floor(v / 60)}min`)
      : null

    return (
      <>
        <div className={styles.cardHeader}>
          <div className={styles.dateSection}>
            <span className={styles.dateLabel}>{formatDate(date)}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {isRecovery && <span className={styles.sessionPill}>Recovery</span>}
              {durationTrend && (
                <span className={styles.trend} style={{ color: durationTrend.color }}>
                  {durationTrend.direction} {durationTrend.value}
                </span>
              )}
            </div>
          </div>
          <div className={styles.primaryMetric}>
            <span className={styles.metricValue}>{durationFormatted}</span>
            <span className={styles.metricLabel}>Duration</span>
          </div>
        </div>

        <div className={styles.cardBody}>
          {/* Summary row */}
          <div className={styles.metricRow}>
            <div className={styles.metricItem}>
              <span className={styles.metricValue}>{templateName}</span>
              <span className={styles.metricLabel}>Template</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricValue}>{exerciseCount}</span>
              <span className={styles.metricLabel}>Exercises</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricValue}>{totalSets}</span>
              <span className={styles.metricLabel}>Sets</span>
            </div>
          </div>

          {totalVolume > 0 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Volume: {totalVolume >= 10000 ? `${(totalVolume / 1000).toFixed(1)}k` : totalVolume.toLocaleString()} lbs
              </span>
            </div>
          )}

          {/* Wearable / Fitbit workout metrics */}
          {(data.workout_calories_burned != null || data.workout_steps != null || data.workout_avg_hr != null) && (
            <div className={styles.metricRow}>
              {data.workout_calories_burned != null && (
                <div className={styles.metricItem}>
                  <span className={styles.metricValue}>{Math.round(data.workout_calories_burned)}</span>
                  <span className={styles.metricLabel}>Calories</span>
                </div>
              )}
              {data.workout_steps != null && (
                <div className={styles.metricItem}>
                  <span className={styles.metricValue}>{data.workout_steps.toLocaleString()}</span>
                  <span className={styles.metricLabel}>Steps</span>
                </div>
              )}
              {data.workout_avg_hr != null && (
                <div className={styles.metricItem}>
                  <span className={styles.metricValue}>{Math.round(data.workout_avg_hr)}</span>
                  <span className={styles.metricLabel}>Avg HR</span>
                </div>
              )}
              {data.workout_peak_hr != null && (
                <div className={styles.metricItem}>
                  <span className={styles.metricValue}>{Math.round(data.workout_peak_hr)}</span>
                  <span className={styles.metricLabel}>Peak HR</span>
                </div>
              )}
              {data.workout_active_minutes != null && (
                <div className={styles.metricItem}>
                  <span className={styles.metricValue}>{data.workout_active_minutes}</span>
                  <span className={styles.metricLabel}>Active Min</span>
                </div>
              )}
            </div>
          )}

          {/* HR Zone breakdown */}
          {data.workout_hr_zones && typeof data.workout_hr_zones === 'object' && (
            <div className={styles.hrZones}>
              {(['rest', 'fatBurn', 'cardio', 'peak'] as const).map(zone => {
                const mins = (data.workout_hr_zones as Record<string, number>)[zone]
                if (!mins) return null
                const labels: Record<string, string> = { rest: 'Rest', fatBurn: 'Fat Burn', cardio: 'Cardio', peak: 'Peak' }
                const colors: Record<string, string> = { rest: '#8884d8', fatBurn: '#82ca9d', cardio: '#ffc658', peak: '#ff7043' }
                const totalZone = Object.values(data.workout_hr_zones as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0)
                const pct = totalZone > 0 ? Math.round((mins / totalZone) * 100) : 0
                return (
                  <div key={zone} className={styles.hrZoneBar}>
                    <span className={styles.hrZoneLabel}>{labels[zone]}</span>
                    <div className={styles.hrZoneTrack}>
                      <div className={styles.hrZoneFill} style={{ width: `${pct}%`, background: colors[zone] }} />
                    </div>
                    <span className={styles.hrZonePct}>{mins}m</span>
                  </div>
                )
              })}
            </div>
          )}

          {bodyParts.length > 0 && (
            <div className={styles.tags}>
              {bodyParts.map((part, i) => (
                <span key={i} className={styles.tag}>{part}</span>
              ))}
            </div>
          )}

          {/* Expandable exercise detail */}
          {exercises.length > 0 && (
            <div className={styles.exerciseToggle} onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded) }}>
              <span>{isExpanded ? '\u25BE' : '\u25B8'} {exercises.length} exercise{exercises.length > 1 ? 's' : ''}</span>
            </div>
          )}

          {isExpanded && exercises.length > 0 && (
            <div className={styles.exerciseList}>
              {exercises.map((ex, i) => {
                const exName = (ex.exercise_name || ex.name || 'Exercise').toString()
                const sets = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
                const workingSets = sets.filter(s => {
                  const w = Number(s?.weight)
                  const r = Number(s?.reps)
                  return (Number.isFinite(w) && w > 0) || (Number.isFinite(r) && r > 0)
                })
                const isBW = sets.some(s => s?.is_bodyweight || s?.weight_label === 'BW')
                const isCardio = (ex.category || '').toLowerCase() === 'cardio'

                const bestSet = workingSets.reduce<{ weight: number; reps: number } | null>((best, s) => {
                  const w = Number(s?.weight) || 0
                  const r = Number(s?.reps) || 0
                  if (!best || w * r > best.weight * best.reps) return { weight: w, reps: r }
                  return best
                }, null)

                // #33: Compare to same exercise in previous session
                const prevExercises: ExerciseEntry[] = Array.isArray(previousData?.workout_exercises) ? previousData.workout_exercises : []
                const prevEx = prevExercises.find(pe => (pe.exercise_name || pe.name || '').toString().toLowerCase() === exName.toLowerCase())
                let comparison: { label: string; color: string } | null = null
                if (prevEx && bestSet && !isCardio) {
                  const prevSets = Array.isArray(prevEx.workout_sets) ? prevEx.workout_sets : []
                  const prevBest = prevSets.reduce<{ weight: number; reps: number } | null>((b, s) => {
                    const w = Number(s?.weight) || 0
                    const r = Number(s?.reps) || 0
                    if (!b || w * r > b.weight * b.reps) return { weight: w, reps: r }
                    return b
                  }, null)
                  if (prevBest && prevBest.weight > 0) {
                    const volDiff = (bestSet.weight * bestSet.reps) - (prevBest.weight * prevBest.reps)
                    if (Math.abs(volDiff) > 0) {
                      comparison = {
                        label: `${volDiff > 0 ? '+' : ''}${Math.round(volDiff)} lbs vol`,
                        color: volDiff > 0 ? 'var(--success, #4caf50)' : 'var(--danger, #f44336)',
                      }
                    }
                  }
                }

                return (
                  <div key={i} className={styles.exerciseRow}>
                    <div className={styles.exerciseIndex}>{i + 1}</div>
                    <div className={styles.exerciseInfo}>
                      <span className={styles.exerciseName}>{exName}</span>
                      <span className={styles.exerciseSummary}>
                        {isCardio ? (
                          sets[0]?.time ? `${Math.round(Number(sets[0].time) / 60)} min` : `${sets.length} set${sets.length > 1 ? 's' : ''}`
                        ) : isBW ? (
                          `${workingSets.length} sets${bestSet?.reps ? ` \u00b7 best: ${bestSet.reps} reps` : ''}`
                        ) : (
                          `${workingSets.length} sets${bestSet ? ` \u00b7 best: ${bestSet.weight}\u00d7${bestSet.reps}` : ''}`
                        )}
                        {comparison && (
                          <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 600, color: comparison.color }}>
                            {comparison.label}
                          </span>
                        )}
                      </span>
                    </div>
                    {ex.body_part && (
                      <span className={styles.exerciseBodyPart}>{ex.body_part}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </>
    )
  }

  const renderHealthCard = () => {
    const weight = data.weight
    const steps = data.steps || data.steps_count || 0
    const hrv = data.hrv
    const calories = data.calories_burned || data.calories || 0
    const sleepTime = data.sleep_time || data.sleep_duration
    const sleepScore = data.sleep_score
    const restingHR = data.resting_heart_rate
    const bodyTemp = data.body_temp

    const activeMetrics = [weight, steps, hrv, calories, sleepTime, sleepScore, restingHR, bodyTemp].filter(v => v != null && v !== 0).length

    return (
      <>
        <div className={styles.cardHeader}>
          <div className={styles.dateSection}>
            <span className={styles.dateLabel}>{formatDate(date)}</span>
            <span className={styles.metricCount}>{activeMetrics} metric{activeMetrics !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className={styles.cardBody}>
          <div className={styles.metricGrid}>
            {weight != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{weight}</span>
                <span className={styles.metricLabel}>Weight (lbs)</span>
              </div>
            )}
            {steps > 0 && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{steps.toLocaleString()}</span>
                <span className={styles.metricLabel}>Steps</span>
              </div>
            )}
            {hrv != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{Math.round(hrv)}</span>
                <span className={styles.metricLabel}>HRV (ms)</span>
              </div>
            )}
            {calories > 0 && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{calories.toLocaleString()}</span>
                <span className={styles.metricLabel}>Calories</span>
              </div>
            )}
            {sleepTime != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>
                  {Math.floor(sleepTime / 60)}h {Math.round(sleepTime % 60)}m
                </span>
                <span className={styles.metricLabel}>Sleep</span>
              </div>
            )}
            {sleepScore != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{Math.round(sleepScore)}</span>
                <span className={styles.metricLabel}>Sleep Score</span>
              </div>
            )}
            {restingHR != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{Math.round(restingHR)}</span>
                <span className={styles.metricLabel}>Resting HR (bpm)</span>
              </div>
            )}
            {bodyTemp != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{bodyTemp.toFixed(1)}</span>
                <span className={styles.metricLabel}>Body Temp (\u00b0F)</span>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <Card
      className={styles.historyCard}
      style={{
        animationDelay: `${index * 0.05}s`,
        '--card-type': type
      } as React.CSSProperties}
      onClick={() => {
        if (onView && typeof onView === 'function') onView()
        if (type === 'fitness') setIsExpanded(!isExpanded)
      }}
    >
      <div className={styles.cardContent}>
        {type === 'fitness' ? renderFitnessCard() : renderHealthCard()}
      </div>

      <div className={styles.cardActions}>
        {onEdit && (
          <button
            className={styles.actionBtn}
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            title="Edit"
          >
            Edit
          </button>
        )}
        {onDelete && (
          <button
            className={`${styles.actionBtn} ${styles.deleteBtn}`}
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="Delete"
          >
            Delete
          </button>
        )}
      </div>
    </Card>
  )
}
