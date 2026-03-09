import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { computeTrainingProfile, type TrainingProfile } from '../lib/trainingAnalysis'
import { generateWorkout, saveGeneratedWorkout, generateWeekPreview, type GeneratedWorkout, type ExerciseRole, type SessionOverrides, type DayPreview } from '../lib/workoutEngine'
import { requireSupabase } from '../lib/supabase'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import BackButton from '../components/BackButton'
import Button from '../components/Button'
import { logError } from '../utils/logger'
import styles from './TodayWorkout.module.css'
import s from '../styles/shared.module.css'

type ViewState = 'loading' | 'ready' | 'error' | 'empty'

export default function TodayWorkout() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [viewState, setViewState] = useState<ViewState>('loading')
  const [workout, setWorkout] = useState<GeneratedWorkout | null>(null)
  const [profile, setProfile] = useState<TrainingProfile | null>(null)
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null)
  const [expandedWarmup, setExpandedWarmup] = useState<Set<number>>(new Set())
  const [regenerating, setRegenerating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [prefsSet, setPrefsSet] = useState(true)
  const [defaultDuration, setDefaultDuration] = useState(75)
  const [durationOverride, setDurationOverride] = useState<number | null>(null)
  const [finishByTime, setFinishByTime] = useState('')
  const [cachedProfile, setCachedProfile] = useState<TrainingProfile | null>(null)
  const [weekPreview, setWeekPreview] = useState<DayPreview[]>([])
  const [restDays, setRestDays] = useState<number[]>([])
  const [excludedExercises, setExcludedExercises] = useState<Set<string>>(new Set())
  const [showExclusionPicker, setShowExclusionPicker] = useState(false)
  const regeneratingRef = useRef(false)

  useEffect(() => {
    if (user) initialLoad()
  }, [user])

  // Initial load: fetch prefs, compute profile, generate first workout
  const initialLoad = async () => {
    if (!user) return
    setViewState('loading')
    try {
      const supabase = requireSupabase()
      // Use select('*') to avoid errors when specific columns don't exist in the schema
      const { data: prefsData, error: prefsError } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      // Only update prefsSet if we actually got a result; don't flip to false on query errors
      if (prefsData && !prefsError) {
        setPrefsSet(!!(prefsData.training_goal && prefsData.session_duration_minutes))
      } else if (!prefsError && !prefsData) {
        setPrefsSet(false)
      }
      if (prefsData?.session_duration_minutes) {
        setDefaultDuration(Number(prefsData.session_duration_minutes))
      }

      const loadedRestDays: number[] = Array.isArray(prefsData?.rest_days) ? prefsData.rest_days : []
      setRestDays(loadedRestDays)

      // Auto-populate finishByTime from saved weekday_deadlines
      const deadlines = prefsData?.weekday_deadlines
      if (deadlines && typeof deadlines === 'object' && !Array.isArray(deadlines)) {
        const todayDow = String(new Date().getDay())
        const todayDeadline = (deadlines as Record<string, string>)[todayDow]
        if (todayDeadline) setFinishByTime(todayDeadline)
      }

      const tp = await computeTrainingProfile(user.id)
      setCachedProfile(tp)
      setProfile(tp)
      setWeekPreview(generateWeekPreview(tp, loadedRestDays))

      if (tp.trainingAgeDays < 7) {
        setViewState('empty')
        return
      }

      const w = await generateWorkout(tp)
      setWorkout(w)
      setViewState('ready')
      saveGeneratedWorkout(user.id, w).catch(e => logError('Save generated workout failed (non-blocking)', e))
    } catch (err) {
      logError('Workout generation error', err)
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate workout')
      setViewState('error')
    }
  }

  // Regeneration: reuses cached profile, only re-runs workout generation
  const regenerate = async (duration: number | null, finishBy: string) => {
    if (!cachedProfile || regeneratingRef.current) return
    regeneratingRef.current = true
    setRegenerating(true)

    try {
      const o: SessionOverrides = {}
      if (duration != null) o.durationMinutes = duration
      if (finishBy) o.finishByTime = finishBy

      const w = await generateWorkout(
        cachedProfile,
        Object.keys(o).length > 0 ? o : undefined
      )
      setWorkout(w)
      showToast('Workout regenerated', 'success')
    } catch (err) {
      logError('Regeneration error', err)
      showToast('Regeneration failed', 'error')
    } finally {
      setRegenerating(false)
      regeneratingRef.current = false
    }
  }

  const handleDurationClick = (mins: number) => {
    const newDuration = mins === durationOverride ? null : mins
    setDurationOverride(newDuration)
    regenerate(newDuration, finishByTime)
  }

  const handleFinishByChange = (time: string) => {
    setFinishByTime(time)
    if (time) regenerate(durationOverride, time)
  }

  const handleClearFinishBy = () => {
    setFinishByTime('')
    regenerate(durationOverride, '')
  }

  const handleRegenerate = () => {
    regenerate(durationOverride, finishByTime)
  }

  const toggleRestDay = async (dow: number) => {
    if (!user) return
    const next = restDays.includes(dow)
      ? restDays.filter(d => d !== dow)
      : [...restDays, dow].sort()
    setRestDays(next)

    if (cachedProfile) {
      setWeekPreview(generateWeekPreview(cachedProfile, next))
    }

    try {
      const supabase = requireSupabase()
      await supabase
        .from('user_preferences')
        .update({ rest_days: next.length > 0 ? next : null })
        .eq('user_id', user.id)
    } catch (err) {
      logError('Failed to save rest days', err)
      showToast('Failed to save rest days', 'error')
    }
  }

  // #28: Swap exercise — regenerate with the current exercise excluded
  const handleSwapExercise = async (exerciseName: string) => {
    if (!cachedProfile || !workout) return
    const newExcluded = new Set(excludedExercises)
    newExcluded.add(exerciseName.toLowerCase())
    setExcludedExercises(newExcluded)

    // Persist swap for ML swap learning
    if (user?.id) {
      try {
        const supabase = requireSupabase()
        await supabase.from('exercise_swaps').insert({
          user_id: user.id,
          exercise_name: exerciseName.toLowerCase(),
        })
      } catch { /* non-fatal */ }
    }

    setRegenerating(true)
    try {
      const o: SessionOverrides = {}
      if (durationOverride != null) o.durationMinutes = durationOverride
      if (finishByTime) o.finishByTime = finishByTime

      const updatedProfile = {
        ...cachedProfile,
        exercisePreferences: cachedProfile.exercisePreferences.filter(
          p => !newExcluded.has(p.exerciseName)
        ),
      }
      const w = await generateWorkout(updatedProfile, Object.keys(o).length > 0 ? o : undefined)
      setWorkout(w)
      showToast(`Swapped ${exerciseName}`, 'success')
    } catch (err) {
      logError('Swap exercise error', err)
      showToast('Swap failed', 'error')
    } finally {
      setRegenerating(false)
    }
  }

  // #29: Toggle exercise exclusion before generation
  const toggleExcludeExercise = (exerciseName: string) => {
    const next = new Set(excludedExercises)
    const key = exerciseName.toLowerCase()
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExcludedExercises(next)
  }

  const handleStartWorkout = () => {
    if (!workout) return
    const exercises = workout.exercises.map(ex => {
      const prescription = {
        exerciseRole: ex.exerciseRole,
        targetRir: ex.targetRir,
        rirLabel: ex.rirLabel,
        warmupSets: ex.warmupSets,
        supersetGroupId: ex.supersetGroupId,
        supersetType: ex.supersetType,
        restSeconds: ex.restSeconds,
        adjustments: ex.adjustments,
        rationale: ex.rationale,
        targetHrZone: ex.targetHrZone,
        targetHrBpmRange: ex.targetHrBpmRange,
        impactScore: ex.impactScore,
        estimatedMinutes: ex.estimatedMinutes,
        tempo: ex.tempo,
      }

      if (ex.isCardio) {
        return {
          name: ex.exerciseName,
          body_part: ex.bodyPart,
          exercise_library_id: ex.exerciseLibraryId,
          category: 'Cardio',
          _prescription: prescription,
          sets: [{
            set_number: 1,
            time: ex.cardioDurationSeconds ?? 1800,
            time_seconds: ex.cardioDurationSeconds ?? 1800,
            speed: ex.cardioSpeed != null ? String(ex.cardioSpeed) : '',
            incline: ex.cardioIncline != null ? String(ex.cardioIncline) : '',
            weight: '',
            reps: '',
          }],
        }
      }
      return {
        name: ex.exerciseName,
        body_part: ex.bodyPart,
        exercise_library_id: ex.exerciseLibraryId,
        category: 'Strength',
        _prescription: prescription,
        sets: Array.from({ length: ex.sets }, (_, i) => ({
          set_number: i + 1,
          target_weight: ex.isBodyweight ? null : ex.targetWeight,
          target_reps: ex.targetReps,
          tempo: ex.tempo,
          _is_bodyweight: ex.isBodyweight,
          weight: ex.isBodyweight ? 'BW' : (ex.targetWeight != null ? String(ex.targetWeight) : ''),
          reps: String(ex.targetReps),
        })),
      }
    })
    sessionStorage.setItem('generated_workout', JSON.stringify({
      exercises,
      generated_workout_id: workout.id,
      sessionRationale: workout.sessionRationale,
    }))
    navigate('/workout/active')
  }

  const parseTempo = (tempo: string | null | undefined) => {
    if (!tempo) return null
    const parts = tempo.split('-').map(Number)
    if (parts.length !== 3 || parts.some(isNaN)) return null
    return { eccentric: parts[0], pause: parts[1], concentric: parts[2] }
  }

  const toggleWarmup = (idx: number) => {
    setExpandedWarmup(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const ROLE_BADGE_COLORS: Record<ExerciseRole, string> = {
    primary: '#3b82f6',
    secondary: '#6b7280',
    isolation: '#eab308',
    corrective: '#ef4444',
    cardio: '#22c55e',
  }

  if (viewState === 'loading') {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <BackButton fallbackPath="/" />
          <h1>Today's Workout</h1>
          <div style={{ width: 32 }} />
        </div>
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
          <p>Analyzing your training history...</p>
          <p className={styles.loadingSub}>Computing recovery, volume, and progression data</p>
        </div>
      </div>
    )
  }

  if (viewState === 'empty') {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <BackButton fallbackPath="/" />
          <h1>Today's Workout</h1>
          <div style={{ width: 32 }} />
        </div>
        <div className={styles.emptyState}>
          <h2>Not Enough Data Yet</h2>
          <p>Log at least a week of workouts so the system can learn your patterns, progression rates, and recovery needs.</p>
          <Button onClick={() => navigate('/workout/active')}>Start a Manual Workout</Button>
        </div>
      </div>
    )
  }

  if (viewState === 'error') {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <BackButton fallbackPath="/" />
          <h1>Today's Workout</h1>
          <div style={{ width: 32 }} />
        </div>
        <div className={styles.emptyState}>
          <h2>Generation Failed</h2>
          <p>{errorMsg}</p>
          <Button onClick={initialLoad}>Try Again</Button>
        </div>
      </div>
    )
  }

  if (!workout) return null

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <BackButton fallbackPath="/" />
        <h1>Today's Workout</h1>
        <div style={{ width: 32 }} />
      </div>

      <div className={styles.content}>
        {/* Preferences prompt */}
        {!prefsSet && (
          <div className={styles.prefsBanner}>
            <div className={styles.prefsBannerText}>
              <strong>Training profile not configured</strong>
              <span>Set your training goal, session duration, equipment, and injuries so the engine can build workouts tailored to you.</span>
            </div>
            <Button variant="secondary" onClick={() => navigate('/profile')} style={{ whiteSpace: 'nowrap', fontSize: '13px', padding: '6px 12px' }}>
              Set Preferences
            </Button>
          </div>
        )}

        {/* Session Controls — duration override + finish-by */}
        <div className={styles.sessionControls}>
          <div className={styles.controlRow}>
            <label className={styles.controlLabel}>Session Time</label>
            <div className={styles.durationControl}>
              {[30, 45, 60, 75, 90, 120].map(mins => (
                <button
                  key={mins}
                  className={`${styles.durationBtn} ${
                    (durationOverride ?? defaultDuration) === mins ? styles.durationBtnActive : ''
                  }`}
                  onClick={() => handleDurationClick(mins)}
                  disabled={regenerating}
                >
                  {mins}m
                </button>
              ))}
            </div>
          </div>
          <div className={styles.controlRow}>
            <label className={styles.controlLabel}>Finish By</label>
            <input
              type="time"
              className={styles.finishByInput}
              value={finishByTime}
              onChange={e => handleFinishByChange(e.target.value)}
              placeholder="No deadline"
              disabled={regenerating}
            />
            {finishByTime && (
              <button className={styles.clearBtn} onClick={handleClearFinishBy} disabled={regenerating}>Clear</button>
            )}
          </div>
          {(durationOverride != null || finishByTime) && (
            <Button variant="secondary" onClick={handleRegenerate} loading={regenerating} style={{ marginTop: 8, width: '100%' }}>
              Regenerate with {durationOverride ? `${durationOverride}m` : ''}{durationOverride && finishByTime ? ' + ' : ''}{finishByTime ? `finish by ${finishByTime}` : ''}
            </Button>
          )}
        </div>

        {/* Week Preview — tap a day to toggle rest */}
        {weekPreview.length > 0 && (
          <div className={styles.weekPreview}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className={styles.weekPreviewTitle}>This Week</h3>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Tap to toggle rest/workout</span>
            </div>
            <div className={styles.weekDays}>
              {weekPreview.map(day => {
                const isRest = restDays.includes(day.dayOfWeek) || (restDays.length === 0 && day.isRestDay)
                return (
                  <div
                    key={day.dayOfWeek}
                    className={`${styles.weekDay} ${day.isToday ? styles.weekDayToday : ''} ${isRest ? styles.weekDayRest : ''}`}
                    onClick={() => toggleRestDay(day.dayOfWeek)}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <div className={styles.weekDayName}>{day.dayName.slice(0, 3)}</div>
                    <div className={styles.weekDayFocus}>
                      {isRest ? 'Rest' : day.focus || 'Workout'}
                    </div>
                    {!isRest && day.muscleGroups.length > 0 && (
                      <div className={styles.weekDayMeta} title={day.muscleGroups.map(g => g.replace(/_/g, ' ')).join(', ')}>
                        {day.estimatedExercises} ex · {day.estimatedMinutes}m
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Detected Split + Session Summary */}
        {profile?.detectedSplit && profile.detectedSplit.confidence >= 0.5 && (
          <div className={styles.splitCard}>
            <div className={styles.splitHeader}>
              <span className={styles.splitType}>{profile.detectedSplit.type.replace(/_/g, ' ')}</span>
              <span className={styles.splitConfidence}>{Math.round(profile.detectedSplit.confidence * 100)}% confidence</span>
            </div>
            {profile.detectedSplit.nextRecommended.length > 0 && (
              <div className={styles.splitRecommendation}>
                Today: <strong>{profile.detectedSplit.nextRecommended.join(' / ')}</strong> day
              </div>
            )}
          </div>
        )}

        <div className={styles.summaryCard}>
          <div className={styles.summaryRow}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Goal</span>
              <span className={styles.summaryValue}>{workout.trainingGoal.replace(/_/g, ' ')}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Duration</span>
              <span className={styles.summaryValue}>
                {Math.round(workout.exercises.reduce((sum, ex) => sum + ex.estimatedMinutes, 0))} min
              </span>
              {workout.estimatedDurationMinutes > 0 && (
                <span className={styles.summaryBudget}>
                  / {workout.estimatedDurationMinutes} min budget
                </span>
              )}
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Recovery</span>
              <span className={`${styles.summaryValue} ${
                workout.recoveryStatus === 'Good' ? styles.good
                : workout.recoveryStatus === 'Reduced capacity' ? styles.warning
                : styles.danger
              }`}>
                {workout.recoveryStatus}
              </span>
            </div>
          </div>
          {workout.deloadActive && (
            <div className={styles.deloadBanner}>
              DELOAD WEEK — Volume reduced to 50%, maintaining intensity
            </div>
          )}
          <div className={styles.muscleGroups}>
            {workout.muscleGroupsFocused.map(g => (
              <span key={g} className={styles.muscleTag}>{g.replace(/_/g, ' ')}</span>
            ))}
          </div>
        </div>

        {/* Adjustments */}
        {workout.adjustmentsSummary.length > 0 && (
          <div className={styles.adjustmentsCard}>
            <h3>Adjustments Applied</h3>
            <ul>
              {workout.adjustmentsSummary.map((adj, i) => (
                <li key={i}>{adj}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Exercises */}
        <div className={styles.exerciseList}>
          {workout.exercises.map((ex, idx) => {
            const isExpanded = expandedExercise === idx
            const tempo = parseTempo(ex.tempo)
            const prevGroup = idx > 0 ? workout.exercises[idx - 1].targetMuscleGroup : null
            const showGroupHeader = ex.targetMuscleGroup !== prevGroup
            return (
              <div key={idx}>
                {showGroupHeader && (
                  <div className={styles.muscleGroupHeader}>
                    {(ex.targetMuscleGroup || ex.bodyPart).replace(/_/g, ' ')}
                  </div>
                )}
              <div className={styles.exerciseCard}>
                <div
                  className={styles.exerciseHeader}
                  onClick={() => setExpandedExercise(isExpanded ? null : idx)}
                >
                  <div className={styles.exerciseInfo}>
                    <span className={styles.exerciseNumber}>{idx + 1}</span>
                    <div>
                      <div className={styles.exerciseNameRow}>
                        <h3 className={styles.exerciseName}>{ex.exerciseName}</h3>
                        <span
                          className={styles.roleBadge}
                          style={{ background: ROLE_BADGE_COLORS[ex.exerciseRole] }}
                        >
                          {ex.exerciseRole}
                        </span>
                        {ex.supersetGroupId != null && (
                          <span className={styles.supersetBadge}>
                            SS{ex.supersetType ? ` · ${ex.supersetType.replace(/_/g, ' ')}` : ''}
                          </span>
                        )}
                      </div>
                      <div className={styles.exerciseMeta}>
                        {ex.isCardio ? (
                          <>
                            {ex.cardioDurationSeconds != null ? `${Math.round(ex.cardioDurationSeconds / 60)} min` : 'Duration TBD'}
                            {ex.cardioSpeed != null && ex.cardioSpeedLabel ? ` — ${ex.cardioSpeedLabel}: ${ex.cardioSpeed}` : ''}
                            {ex.cardioIncline != null ? ` — ${ex.cardioIncline}% incline` : ''}
                            {ex.targetHrZone != null && (
                              <span className={styles.hrZone}>
                                {' '}— Zone {ex.targetHrZone}
                                {ex.targetHrBpmRange ? ` (${ex.targetHrBpmRange.min}–${ex.targetHrBpmRange.max} bpm)` : ''}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {ex.sets} × {ex.targetReps}
                            {ex.isBodyweight ? ' (BW)' : ex.targetWeight != null ? ` @ ${ex.targetWeight} lbs` : ''}
                          </>
                        )}
                      </div>
                      {!ex.isCardio && ex.targetRir != null && ex.rirLabel && (
                        <div className={styles.rirLabel}>{ex.rirLabel} (RIR {ex.targetRir})</div>
                      )}
                    </div>
                  </div>
                  <span className={styles.expandArrow}>{isExpanded ? '▼' : '▶'}</span>
                </div>

                {isExpanded && (
                  <div className={styles.exerciseDetails}>
                    {!ex.isCardio && ex.warmupSets && ex.warmupSets.length > 0 && (
                      <div className={styles.warmupSection}>
                        <div
                          className={styles.warmupToggle}
                          onClick={(e) => { e.stopPropagation(); toggleWarmup(idx) }}
                        >
                          <span>{expandedWarmup.has(idx) ? '▾' : '▸'} Warmup ({ex.warmupSets.length} sets)</span>
                        </div>
                        {expandedWarmup.has(idx) && (
                          <div className={styles.warmupSets}>
                            {ex.warmupSets.map((ws, wi) => (
                              <div key={wi} className={styles.warmupSetRow}>
                                {ws.weight} lbs × {ws.reps}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <table className={styles.detailTable}>
                      <tbody>
                        {ex.isCardio ? (
                          <>
                            <tr>
                              <td className={styles.detailLabel}>Duration</td>
                              <td>{ex.cardioDurationSeconds != null ? `${Math.round(ex.cardioDurationSeconds / 60)} minutes` : 'Based on feel'}</td>
                            </tr>
                            {ex.cardioSpeed != null && (
                              <tr>
                                <td className={styles.detailLabel}>{ex.cardioSpeedLabel ?? 'Intensity'}</td>
                                <td>{ex.cardioSpeed}</td>
                              </tr>
                            )}
                            {ex.cardioIncline != null && (
                              <tr>
                                <td className={styles.detailLabel}>Incline</td>
                                <td>{ex.cardioIncline}%</td>
                              </tr>
                            )}
                            {ex.targetHrZone != null && (
                              <tr>
                                <td className={styles.detailLabel}>HR Zone</td>
                                <td>
                                  Zone {ex.targetHrZone}
                                  {ex.targetHrBpmRange ? ` (${ex.targetHrBpmRange.min}–${ex.targetHrBpmRange.max} bpm)` : ''}
                                </td>
                              </tr>
                            )}
                          </>
                        ) : (
                          <>
                            <tr>
                              <td className={styles.detailLabel}>Role</td>
                              <td style={{ textTransform: 'capitalize' }}>{ex.exerciseRole}</td>
                            </tr>
                            <tr>
                              <td className={styles.detailLabel}>Movement</td>
                              <td>{ex.movementPattern.replace(/_/g, ' ')}</td>
                            </tr>
                            {ex.targetRir != null && (
                              <tr>
                                <td className={styles.detailLabel}>RIR</td>
                                <td>{ex.targetRir} — {ex.rirLabel}</td>
                              </tr>
                            )}
                            {tempo && (
                              <tr>
                                <td className={styles.detailLabel}>Tempo</td>
                                <td>{tempo.eccentric}s down / {tempo.pause}s pause / {tempo.concentric}s up</td>
                              </tr>
                            )}
                            <tr>
                              <td className={styles.detailLabel}>Rest</td>
                              <td>{ex.restSeconds}s between sets</td>
                            </tr>
                            <tr>
                              <td className={styles.detailLabel}>Est. Time</td>
                              <td>{Math.round(ex.estimatedMinutes)} min</td>
                            </tr>
                            {ex.supersetGroupId != null && (
                              <tr>
                                <td className={styles.detailLabel}>Superset</td>
                                <td style={{ textTransform: 'capitalize' }}>
                                  Group {ex.supersetGroupId} — {ex.supersetType?.replace(/_/g, ' ') ?? 'paired'}
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                        <tr>
                          <td className={styles.detailLabel}>Primary</td>
                          <td>{ex.primaryMuscles.map(m => m.replace(/_/g, ' ')).join(', ') || '—'}</td>
                        </tr>
                        {ex.secondaryMuscles.length > 0 && (
                          <tr>
                            <td className={styles.detailLabel}>Secondary</td>
                            <td>{ex.secondaryMuscles.map(m => m.replace(/_/g, ' ')).join(', ')}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>

                    {ex.adjustments.length > 0 && (
                      <div className={styles.exerciseAdjustments}>
                        {ex.adjustments.map((adj, i) => (
                          <div key={i} className={styles.adjustmentTag}>{adj}</div>
                        ))}
                      </div>
                    )}

                    <div className={styles.rationaleText}>{ex.rationale}</div>

                    {/* #28: Exercise swap button */}
                    {!ex.isCardio && (
                      <button
                        className={styles.swapBtn}
                        onClick={(e) => { e.stopPropagation(); handleSwapExercise(ex.exerciseName) }}
                        disabled={regenerating}
                      >
                        Swap Exercise
                      </button>
                    )}
                  </div>
                )}
              </div>
              </div>
            )
          })}
        </div>

        {/* #30: Per-muscle recovery status */}
        {profile && profile.muscleRecovery.length > 0 && (
          <details className={styles.contextCard}>
            <summary>Muscle Recovery Status</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px', padding: '8px 0' }}>
              {profile.muscleRecovery.map(mr => (
                <div key={mr.muscleGroup} style={{
                  padding: '6px 8px', borderRadius: '6px', fontSize: '12px',
                  background: mr.readyToTrain ? 'var(--surface-success, #e8f5e9)' : 'var(--surface-warning, #fff3e0)',
                  color: 'var(--text-primary)',
                }}>
                  <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{mr.muscleGroup.replace(/_/g, ' ')}</div>
                  <div>{mr.recoveryPercent}% — {mr.readyToTrain ? 'Ready' : `${Math.round(mr.baselineRecoveryHours - mr.hoursSinceLastTrained)}h left`}</div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Training Context — so the user can see the data feeding the model */}
        {profile && (
          <details className={styles.contextCard}>
            <summary>Training Context (Your Data)</summary>
            <div className={styles.contextGrid}>
              <div className={styles.contextItem}>
                <span className="label">Frequency</span>
                <span className="value">{profile.trainingFrequency} days/wk</span>
              </div>
              <div className={styles.contextItem}>
                <span className="label">Avg Session</span>
                <span className="value">{Math.round(profile.avgSessionDuration / 60)} min</span>
              </div>
              <div className={styles.contextItem}>
                <span className="label">Training Age</span>
                <span className="value">{profile.trainingAgeDays} days</span>
              </div>
              <div className={styles.contextItem}>
                <span className="label">Consistency</span>
                <span className="value">{Math.round(profile.consistencyScore * 100)}%</span>
              </div>
              <div className={styles.contextItem}>
                <span className="label">Weight Trend</span>
                <span className="value">{profile.bodyWeightTrend.phase} ({profile.bodyWeightTrend.slope > 0 ? '+' : ''}{profile.bodyWeightTrend.slope} lbs/wk)</span>
              </div>
              <div className={styles.contextItem}>
                <span className="label">Last Sleep</span>
                <span className="value">{profile.recoveryContext.sleepDurationLastNight != null ? `${(profile.recoveryContext.sleepDurationLastNight / 60).toFixed(1)} hrs` : 'N/A'}</span>
              </div>
              {profile.recoveryContext.hrvLastNight != null && (
                <div className={styles.contextItem}>
                  <span className="label">Last HRV</span>
                  <span className="value">{Math.round(profile.recoveryContext.hrvLastNight)} ms</span>
                </div>
              )}
              {profile.recoveryContext.stepsYesterday != null && (
                <div className={styles.contextItem}>
                  <span className="label">Steps Yesterday</span>
                  <span className="value">{Number(profile.recoveryContext.stepsYesterday).toLocaleString()}</span>
                </div>
              )}
            </div>
            {profile.strengthPercentiles && profile.strengthPercentiles.length > 0 && (
              <div style={{ marginTop: '12px', padding: '0 4px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', opacity: 0.8 }}>Strength Level (vs. population)</div>
                <div className={styles.contextGrid}>
                  {profile.strengthPercentiles.map(sp => {
                    const hasAgeAdj = sp.ageAdjustedPercentile != null && sp.ageAdjustedPercentile !== sp.percentile;
                    return (
                      <div key={sp.lift} className={styles.contextItem}>
                        <span className="label">{sp.lift.charAt(0).toUpperCase() + sp.lift.slice(1)} e1RM</span>
                        <span className="value">
                          {sp.estimated1RM} lbs — {sp.percentile}th %ile
                          {hasAgeAdj && <span style={{ opacity: 0.7 }}> ({sp.ageAdjustedPercentile}th age-adj)</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {profile.healthPercentiles && profile.healthPercentiles.length > 0 && (
              <div style={{ marginTop: '12px', padding: '0 4px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', opacity: 0.8 }}>Health Metrics (vs. age group)</div>
                <div className={styles.contextGrid}>
                  {profile.healthPercentiles.map(hp => (
                    <div key={hp.metric} className={styles.contextItem}>
                      <span className="label">{hp.label}</span>
                      <span className="value">{hp.value} {hp.unit} — {hp.percentile}th %ile</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {profile.athleteProfile && profile.athleteProfile.items.length > 0 && (
              <div style={{ marginTop: '12px', padding: '0 4px' }}>
                <div className={s.rowBetween} style={{ marginBottom: '6px' }}>
                  <div className={s.sectionLabel} style={{ margin: 0 }}>Athlete Profile</div>
                  <div className={s.scoreDisplay} style={{ padding: '3px 8px', minWidth: 'auto' }}>
                    <span className={s.scoreValue} style={{
                      fontSize: 16,
                      color: profile.athleteProfile.overallScore >= 70 ? 'var(--success)' : profile.athleteProfile.overallScore >= 45 ? '#e6a800' : '#ef4444'
                    }}>
                      {profile.athleteProfile.overallScore}
                    </span>
                  </div>
                </div>
                <div className={s.sectionSubtitle}>{profile.athleteProfile.summary}</div>
                {(['strength', 'weakness', 'opportunity', 'watch'] as const).map(cat => {
                  const catItems = profile.athleteProfile.items.filter(i => i.category === cat);
                  if (catItems.length === 0) return null;
                  const clsMap = { strength: s.profileItemStrength, weakness: s.profileItemWeakness, opportunity: s.profileItemOpportunity, watch: s.profileItemWatch };
                  const labelMap = { strength: 'Strengths', weakness: 'Focus Areas', opportunity: 'Opportunities', watch: 'Watch' };
                  return (
                    <div key={cat} style={{ marginBottom: '6px' }}>
                      <div className={s.sectionLabel}>{labelMap[cat]}</div>
                      {catItems.map((item, idx) => (
                        <div key={idx} className={clsMap[cat]}>
                          <div className={s.profileItemTitle}>{item.area}</div>
                          <div className={s.profileItemDetail}>{item.detail}</div>
                          <div className={s.profileItemData}>{item.dataPoints}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </details>
        )}

        {/* Decision Log — step-by-step model reasoning */}
        {workout.decisionLog && workout.decisionLog.length > 0 && (
          <details className={styles.decisionLogCard}>
            <summary>Decision Log — Why This Workout</summary>
            {workout.decisionLog.map((entry, i) => (
              <div key={i} className={styles.decisionStep}>
                <div className={styles.stepHeader}>
                  <span className={styles.stepNumber}>{entry.step}</span>
                  <span className={styles.stepLabel}>{entry.label}</span>
                </div>
                <ul className={styles.stepDetails}>
                  {entry.details.map((d, j) => (
                    <li key={j}>{d}</li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        )}

        {/* Muscle Group Selection Table */}
        {workout.muscleGroupDecisions && workout.muscleGroupDecisions.length > 0 && (
          <details className={styles.rationaleCard}>
            <summary>Muscle Group Decisions</summary>
            <table className={styles.decisionTable}>
              <thead>
                <tr>
                  <th>Muscle Group</th>
                  <th>Weekly Sets</th>
                  <th>Target</th>
                  <th>Recovery</th>
                  <th>Priority</th>
                  <th>Rx Sets</th>
                </tr>
              </thead>
              <tbody>
                {workout.muscleGroupDecisions.map(g => (
                  <tr key={g.muscleGroup}>
                    <td style={{ textTransform: 'capitalize' }}>{g.muscleGroup.replace(/_/g, ' ')}</td>
                    <td>{g.weeklyVolume ?? '—'}</td>
                    <td>{g.volumeTarget ?? '—'}</td>
                    <td>{g.recoveryPercent != null ? `${g.recoveryPercent}%` : '—'}</td>
                    <td>{(g.priority ?? 0).toFixed(2)}</td>
                    <td>{g.targetSets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {/* Exercise Scoring — why each exercise was chosen over alternatives */}
        {workout.exerciseDecisions && workout.exerciseDecisions.length > 0 && (
          <details className={styles.scoringCard}>
            <summary>Exercise Scoring (Top Candidates)</summary>
            {(() => {
              const groups = new Map<string, typeof workout.exerciseDecisions>();
              for (const d of workout.exerciseDecisions) {
                const list = groups.get(d.muscleGroup) ?? [];
                list.push(d);
                groups.set(d.muscleGroup, list);
              }
              return Array.from(groups.entries()).map(([group, decisions]) => (
                <div key={group} className={styles.scoreGroup}>
                  <div className={styles.scoreGroupLabel}>{group.replace(/_/g, ' ')}</div>
                  {decisions.map((d, i) => {
                    const isSelected = workout.exercises.some(e => e.exerciseName === d.exerciseName);
                    return (
                      <div key={i}>
                        <div className={styles.scoreEntry}>
                          <span className="name" style={{ fontWeight: isSelected ? 700 : 400 }}>
                            {isSelected ? '★ ' : ''}{d.exerciseName}
                          </span>
                          <span className="score">{d.score}</span>
                        </div>
                        <ul className={styles.scoreFactors}>
                          {d.factors.map((f, j) => <li key={j}>{f}</li>)}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
          </details>
        )}

        {/* Session Rationale */}
        <details className={styles.rationaleCard}>
          <summary>Session Rationale</summary>
          <pre className={styles.rationaleContent}>{workout.sessionRationale}</pre>
        </details>

        {/* Actions */}
        <div className={styles.actions}>
          <Button onClick={handleStartWorkout} style={{ flex: 2 }}>
            Start This Workout
          </Button>
          <Button variant="secondary" onClick={handleRegenerate} loading={regenerating} style={{ flex: 1 }}>
            Regenerate
          </Button>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
    </div>
  )
}
