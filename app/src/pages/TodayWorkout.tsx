import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { computeTrainingProfile, type TrainingProfile } from '../lib/trainingAnalysis'
import {
  generateWorkout,
  saveGeneratedWorkout,
  generateWeekPreview,
  generateWeeklyPlan,
  recomputeWeeklyPlanWithDiff,
  type WeeklyPlan,
  type WeeklyPlanDay,
  type GeneratedWorkout,
  type ExerciseRole,
  type SessionOverrides,
  type DayPreview
} from '../lib/workoutEngine'
import { requireSupabase } from '../lib/supabase'
import { fetchWorkoutReview, fetchWorkoutValidation, type WorkoutReview, type WorkoutValidation } from '../lib/insightsApi'
import { getActiveWeeklyPlanFromSupabase, saveWeeklyPlanToSupabase } from '../lib/supabaseDb'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import BackButton from '../components/BackButton'
import Button from '../components/Button'
import { getLocalDate } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import { evaluateSchemaGate, probeSchemaCapabilities } from '../lib/schemaCapability'
import styles from './TodayWorkout.module.css'
import s from '../styles/shared.module.css'

type ViewState = 'loading' | 'ready' | 'error' | 'empty' | 'completed'

function deriveWorkoutName(w: { template_name?: string; workout_exercises?: { body_part: string }[] }): string {
  if (w.template_name && w.template_name !== 'Freestyle') return w.template_name
  if (!w.workout_exercises || w.workout_exercises.length === 0) return w.template_name || 'Workout'
  const bodyParts = w.workout_exercises
    .map(ex => ex.body_part)
    .filter((bp): bp is string => !!bp && bp !== 'Other' && bp !== 'Cardio')
  const unique = [...new Set(bodyParts)]
  if (unique.length > 0) return unique.slice(0, 3).join(', ')
  return w.template_name || 'Workout'
}

export default function TodayWorkout() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [viewState, setViewState] = useState<ViewState>('loading')
  const [workout, setWorkout] = useState<GeneratedWorkout | null>(null)
  const [profile, setProfile] = useState<TrainingProfile | null>(null)
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null)
  const [expandedWarmup, setExpandedWarmup] = useState<Set<number>>(new Set())
  const [expandedWhy, setExpandedWhy] = useState<Set<number>>(new Set())
  const [regenerating, setRegenerating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [prefsSet, setPrefsSet] = useState(true)
  const [defaultDuration, setDefaultDuration] = useState(120)
  const [durationOverride, setDurationOverride] = useState<number | null>(null)
  const [finishByTime, setFinishByTime] = useState('')
  const [cachedProfile, setCachedProfile] = useState<TrainingProfile | null>(null)
  const [weekPreview, setWeekPreview] = useState<DayPreview[]>([])
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null)
  const [weeklyDiffsByDate, setWeeklyDiffsByDate] = useState<Record<string, any>>({})
  const [selectedPlanDate, setSelectedPlanDate] = useState<string>('')
  const [regeneratingDay, setRegeneratingDay] = useState(false)
  const [restDays, setRestDays] = useState<number[]>([])
  const [excludedExercises, setExcludedExercises] = useState<Set<string>>(new Set())
  const [showExclusionPicker, setShowExclusionPicker] = useState(false)
  const [completedWorkout, setCompletedWorkout] = useState<any | null>(null)
  const [workoutReview, setWorkoutReview] = useState<WorkoutReview | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [llmValidation, setLlmValidation] = useState<WorkoutValidation | null>(null)
  const [originalWorkout, setOriginalWorkout] = useState<GeneratedWorkout | null>(null)
  const [adjustedWorkoutCandidate, setAdjustedWorkoutCandidate] = useState<GeneratedWorkout | null>(null)
  const [adjustedValidation, setAdjustedValidation] = useState<WorkoutValidation | null>(null)
  const [regeneratingWithLlm, setRegeneratingWithLlm] = useState(false)
  const [selectedWorkoutVersion, setSelectedWorkoutVersion] = useState<'original' | 'adjusted'>('original')
  const llmValidationFiredRef = useRef(false)
  const regeneratingRef = useRef(false)
  const forceGenerateRef = useRef(false)

  const getWeekStartDate = (d: Date): string => {
    const x = new Date(d)
    const dow = x.getDay()
    const shiftToMonday = dow === 0 ? -6 : 1 - dow
    x.setDate(x.getDate() + shiftToMonday)
    return getLocalDate(x)
  }

  const isSchemaColumnError = (err: any): boolean => {
    const msg = `${err?.message || ''}`.toLowerCase()
    return err?.code === '42703' || msg.includes('column') || msg.includes('does not exist')
  }

  const workoutSelectCandidates = [
    `
      id,
      date,
      duration,
      template_name,
      workout_exercises(
        id,
        exercise_name,
        body_part,
        category,
        workout_sets(
          set_number,
          weight,
          reps,
          time,
          time_seconds,
          is_warmup
        )
      )
    `,
    `
      id,
      date,
      duration,
      template_name,
      workout_exercises(
        id,
        exercise_name,
        body_part,
        workout_sets(
          set_number,
          weight,
          reps,
          time,
          time_seconds
        )
      )
    `,
    `
      id,
      date,
      duration,
      template_name,
      workout_exercises(
        id,
        exercise_name,
        body_part,
        workout_sets(
          set_number,
          weight,
          reps,
          time
        )
      )
    `,
  ]

  const fetchWorkoutsForDateRange = async (start: string, end: string): Promise<any[]> => {
    if (!user) return []
    const supabase = requireSupabase()
    let lastErr: any = null
    for (const sel of workoutSelectCandidates) {
      const { data, error } = await supabase
        .from('workouts')
        .select(sel)
        .eq('user_id', user.id)
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true })
      if (!error) return Array.isArray(data) ? data : []
      lastErr = error
      if (!isSchemaColumnError(error)) break
    }
    if (lastErr) throw lastErr
    return []
  }

  const fetchWorkoutForDate = async (date: string): Promise<any | null> => {
    if (!user) return null
    const supabase = requireSupabase()
    let lastErr: any = null
    for (const sel of workoutSelectCandidates) {
      const { data, error } = await supabase
        .from('workouts')
        .select(sel)
        .eq('user_id', user.id)
        .eq('date', date)
        .limit(1)
        .maybeSingle()
      if (!error) return data ?? null
      lastErr = error
      if (!isSchemaColumnError(error)) break
    }
    if (lastErr) throw lastErr
    return null
  }

  const applyImmediateCorrectionsToWorkout = (
    baseWorkout: GeneratedWorkout,
    corrections: Array<{ exerciseName: string; issue: string; fix: string; newValue: number | null; reason: string }>
  ): { workout: GeneratedWorkout; appliedCount: number } => {
    if (!Array.isArray(corrections) || corrections.length === 0) {
      return { workout: baseWorkout, appliedCount: 0 }
    }
    const updated: GeneratedWorkout = { ...baseWorkout, exercises: [...baseWorkout.exercises] }
    const estimateExerciseMinutesFromPrescription = (ex: any): number => {
      if (ex?.isCardio) {
        const cardioMin = Math.max(5, Math.round((Number(ex.cardioDurationSeconds) || 0) / 60))
        return cardioMin + 2
      }
      const sets = Math.max(1, Number(ex?.sets) || 0)
      const warmups = Array.isArray(ex?.warmupSets) ? ex.warmupSets.length : 0
      const totalSets = sets + warmups
      const repSeconds = ex?.exerciseRole === 'primary' ? 45 : ex?.exerciseRole === 'secondary' ? 38 : 32
      const workMinutes = (totalSets * repSeconds) / 60
      const restMinutes = (Math.max(0, sets - 1) * Math.max(30, Number(ex?.restSeconds) || 60)) / 60
      const warmupMinutes = warmups * 0.5
      return Math.max(3, Math.round(workMinutes + restMinutes + warmupMinutes))
    }
    let appliedCount = 0
    for (const corr of corrections) {
      const idx = updated.exercises.findIndex(
        e => e.exerciseName.toLowerCase() === String(corr.exerciseName || '').toLowerCase()
      )
      if (idx === -1) continue

      if (corr.fix === 'sets' && typeof corr.newValue === 'number') {
        updated.exercises[idx] = {
          ...updated.exercises[idx],
          sets: corr.newValue,
          estimatedMinutes: estimateExerciseMinutesFromPrescription({ ...updated.exercises[idx], sets: corr.newValue }),
          adjustments: [...(updated.exercises[idx].adjustments || []), `LLM correction: ${corr.issue} -> ${corr.newValue} sets (${corr.reason})`],
        }
        appliedCount += 1
      } else if (corr.fix === 'weight' && typeof corr.newValue === 'number') {
        updated.exercises[idx] = {
          ...updated.exercises[idx],
          targetWeight: corr.newValue,
          adjustments: [...(updated.exercises[idx].adjustments || []), `LLM correction: ${corr.issue} -> ${corr.newValue} lbs (${corr.reason})`],
        }
        appliedCount += 1
      } else if (corr.fix === 'remove') {
        updated.exercises.splice(idx, 1)
        appliedCount += 1
      }
    }
    updated.estimatedDurationMinutes = Math.round(updated.exercises.reduce((sum, ex) => sum + (Number((ex as any).estimatedMinutes) || 0), 0))
    return { workout: updated, appliedCount }
  }

  const attachActualWeekWorkouts = async (plan: WeeklyPlan): Promise<WeeklyPlan> => {
    if (!user || !plan?.days?.length) return plan
    try {
      const start = plan.weekStartDate
      const end = plan.days[plan.days.length - 1]?.planDate || plan.weekStartDate
      const workouts = await fetchWorkoutsForDateRange(start, end)

      const byDate = new Map<string, any>()
      for (const w of workouts ?? []) {
        const st = (w.session_type || w.sessionType || 'workout').toString().toLowerCase()
        if (st !== 'workout') continue
        byDate.set(w.date, w)
      }
      return {
        ...plan,
        days: plan.days.map(d => {
          const actual = byDate.get(d.planDate)
          if (!actual) return d
          return {
            ...d,
            dayStatus: 'completed',
            actualWorkoutId: actual.id,
            actualWorkout: actual,
          }
        })
      }
    } catch {
      return plan
    }
  }

  const hasConsecutiveDuplicateTrainingDays = (plan: WeeklyPlan): boolean => {
    const days = Array.isArray(plan?.days) ? plan.days : []
    const getSig = (d: WeeklyPlanDay) =>
      (d?.plannedWorkout?.exercises ?? [])
        .filter((ex: any) => !ex?.isCardio)
        .map((ex: any) => `${String(ex?.exerciseName || '').toLowerCase()}|${Number(ex?.sets) || 0}|${Number(ex?.targetReps) || 0}`)
        .join(';;')
    let prevSig: string | null = null
    for (const d of days) {
      if (d.isRestDay || d.dayStatus === 'completed') continue
      const sig = getSig(d)
      if (!sig) continue
      if (prevSig && sig === prevSig) return true
      prevSig = sig
    }
    return false
  }

  const hydrateWeeklyPlan = async (tp: TrainingProfile, userRestDays: number[]) => {
    if (!user) return
    const weekStartDate = getWeekStartDate(new Date())
    const existing = await getActiveWeeklyPlanFromSupabase(user.id, weekStartDate).catch(() => null)
    if (existing?.days?.length) {
      const validatedExisting = await annotateWeeklyPlanVerdicts(tp, existing as WeeklyPlan)
      const mergedExisting = await attachActualWeekWorkouts(validatedExisting)
      if (hasConsecutiveDuplicateTrainingDays(mergedExisting)) {
        let repaired = mergedExisting
        let repairedDiffs: any[] = []
        for (let i = 0; i < 2; i++) {
          const next = await recomputeWeeklyPlanWithDiff(repaired, tp, userRestDays)
          repaired = await attachActualWeekWorkouts(await annotateWeeklyPlanVerdicts(tp, next.plan))
          repairedDiffs = next.diffs
          if (!hasConsecutiveDuplicateTrainingDays(repaired)) break
        }
        setWeeklyPlan(repaired)
        await saveWeeklyPlanToSupabase(user.id, repaired, repairedDiffs).catch(() => null)
      } else {
        setWeeklyPlan(mergedExisting)
      }
      return
    }
    const generatedPlan = await generateWeeklyPlan(tp, userRestDays)
    const validatedGenerated = await annotateWeeklyPlanVerdicts(tp, generatedPlan)
    const mergedGenerated = await attachActualWeekWorkouts(validatedGenerated)
    const planId = await saveWeeklyPlanToSupabase(user.id, mergedGenerated).catch(() => null)
    setWeeklyPlan(mergedGenerated)
    if (planId) {
      setWeeklyDiffsByDate({})
    }
  }

  const annotateWeeklyPlanVerdicts = async (tp: TrainingProfile, plan: WeeklyPlan): Promise<WeeklyPlan> => {
    const today = getLocalDate()
    const targets = plan.days
      .filter(d => !d.isRestDay && d.plannedWorkout)
      .filter(d => d.planDate >= today)
      .slice(0, 2)
    if (targets.length === 0) return plan

    const verdictMap = new Map<string, {
      verdict: 'pass' | 'minor_issues' | 'major_issues';
      corrections: any[];
      correctedWorkout?: GeneratedWorkout | null;
    }>()
    for (const t of targets) {
      try {
        const validation = await fetchWorkoutValidation(tp, t.plannedWorkout)
        const corrected = validation.immediate_corrections?.length
          ? applyImmediateCorrectionsToWorkout(t.plannedWorkout!, validation.immediate_corrections).workout
          : t.plannedWorkout
        verdictMap.set(t.planDate, {
          verdict: validation.verdict,
          corrections: validation.immediate_corrections ?? [],
          correctedWorkout: corrected,
        })
      } catch {
        // non-fatal
      }
    }
    return {
      ...plan,
      days: plan.days.map(d => {
        const v = verdictMap.get(d.planDate)
        if (!v) return d
        return { ...d, llmVerdict: v.verdict, llmCorrections: v.corrections, plannedWorkout: v.correctedWorkout ?? d.plannedWorkout, dayStatus: d.dayStatus === 'completed' ? 'completed' : (v.verdict === 'pass' ? (d.dayStatus || 'planned') : 'adapted') }
      })
    } as WeeklyPlan
  }

  useEffect(() => {
    if (user) initialLoad()
  }, [user])

  useEffect(() => {
    if (!weeklyPlan?.days?.length) return
    if (selectedPlanDate && weeklyPlan.days.some(d => d.planDate === selectedPlanDate)) return
    const today = getLocalDate()
    const todayMatch = weeklyPlan.days.find(d => d.planDate === today)
    setSelectedPlanDate(todayMatch?.planDate || weeklyPlan.days[0].planDate)
  }, [weeklyPlan, selectedPlanDate])

  useEffect(() => {
    if (!llmValidation || !workout) return

    if (llmValidation.pattern_observations?.length && user) {
      const supabase = requireSupabase()
      const rows = llmValidation.pattern_observations.map(obs => ({
        user_id: user.id,
        feedback_type: 'pattern_observation' as const,
        feedback_data: obs,
        feedback_source: 'model_review' as const,
        feedback_quality: 'unverified' as const,
        verified_by_user: false,
        workout_date: getLocalDate(),
      }))
      supabase.from('model_feedback').insert(rows)
        .then(({ error }) => { if (error) logError('Failed to store pattern observations', error) })
    }
  }, [llmValidation])

  // Initial load: fetch prefs, compute profile, generate first workout
  const initialLoad = async () => {
    if (!user) return
    setViewState('loading')
    try {
      const caps = await probeSchemaCapabilities().catch(() => null)
      const gate = evaluateSchemaGate(caps)
      if (!gate.ok) {
        setErrorMsg(gate.message || 'Database schema is incompatible with this feature path.')
        setViewState('error')
        return
      }

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
      if (prefsData?.session_duration_minutes != null) {
        const loaded = Number(prefsData.session_duration_minutes)
        setDefaultDuration(Number.isFinite(loaded) && loaded > 0 ? loaded : 120)
      }

      const loadedRestDays: number[] = Array.isArray(prefsData?.rest_days) ? prefsData.rest_days : []
      setRestDays(loadedRestDays)

      // Finish-by is now an explicit per-generation override in this screen.
      // Do not auto-apply persisted weekday deadlines silently.
      setFinishByTime('')

      const tp = await computeTrainingProfile(user.id)
      setCachedProfile(tp)
      setProfile(tp)

      const today = getLocalDate()
      const existingWorkout = await fetchWorkoutForDate(today)

      const todayDone = !!(existingWorkout && !forceGenerateRef.current)
      const completedName = existingWorkout ? deriveWorkoutName(existingWorkout) : undefined
      setWeekPreview(generateWeekPreview(
        tp,
        loadedRestDays,
        todayDone,
        completedName
      ))
      await hydrateWeeklyPlan(tp, loadedRestDays)
      if (existingWorkout) {
        setWeeklyPlan(prev => {
          if (!prev?.days?.length) return prev
          return {
            ...prev,
            days: prev.days.map(d => d.planDate === today
              ? {
                  ...d,
                  dayStatus: 'completed',
                  actualWorkoutId: existingWorkout.id,
                  actualWorkout: existingWorkout,
                }
              : d),
          }
        })
      }

      if (todayDone) {
        setCompletedWorkout(existingWorkout)
        setViewState('completed')
        return
      }
      forceGenerateRef.current = false

      if (tp.trainingAgeDays < 3) {
        setViewState('empty')
        return
      }

      const w = await generateWorkout(tp)
      setWorkout(w)
      setOriginalWorkout(w)
      setAdjustedWorkoutCandidate(null)
      setAdjustedValidation(null)
      setSelectedWorkoutVersion('original')
      setViewState('ready')
      saveGeneratedWorkout(user.id, w).catch(e => logError('Save generated workout failed (non-blocking)', e))

      if (!llmValidationFiredRef.current) {
        llmValidationFiredRef.current = true
        fetchWorkoutValidation(tp, w).then(setLlmValidation).catch(e => logError('LLM workout validation failed (non-blocking)', e))
      }
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
      setOriginalWorkout(w)
      setAdjustedWorkoutCandidate(null)
      setAdjustedValidation(null)
      setSelectedWorkoutVersion('original')
      setWorkoutReview(null)
      setReviewError(null)
      setLlmValidation(null)
      llmValidationFiredRef.current = false
      showToast('Workout regenerated', 'success')

      llmValidationFiredRef.current = true
      fetchWorkoutValidation(cachedProfile, w).then(setLlmValidation).catch(e => logError('LLM workout validation failed (non-blocking)', e))

      if (weeklyPlan) {
        const recomputed = await recomputeWeeklyPlanWithDiff(weeklyPlan, cachedProfile, restDays)
        const withVerdicts = await annotateWeeklyPlanVerdicts(cachedProfile, recomputed.plan)
        const withActuals = await attachActualWeekWorkouts(withVerdicts)
        setWeeklyPlan(withActuals)
        const diffMap: Record<string, any> = {}
        for (const d of recomputed.diffs) diffMap[d.planDate] = d
        setWeeklyDiffsByDate(diffMap)
        if (user) {
          await saveWeeklyPlanToSupabase(user.id, withActuals, recomputed.diffs).catch(() => null)
        }
      }
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

  const regenerateWithLlmAdjustments = async () => {
    if (!cachedProfile || !workout || regeneratingWithLlm) return
    setRegeneratingWithLlm(true)
    try {
      const baseline = originalWorkout || workout
      let candidate = baseline
      let validation = llmValidation ?? await fetchWorkoutValidation(cachedProfile, candidate)
      const avoid = new Set<string>()
      const ATTEMPTS = 4

      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (validation.verdict === 'pass') break

        for (const c of validation.immediate_corrections || []) {
          const n = String(c.exerciseName || '').trim().toLowerCase()
          if (n) avoid.add(n)
        }

        const o: SessionOverrides = {}
        if (durationOverride != null) o.durationMinutes = durationOverride
        if (finishByTime) o.finishByTime = finishByTime
        if (avoid.size > 0) o.avoidExerciseNames = [...avoid]

        candidate = await generateWorkout(cachedProfile, Object.keys(o).length > 0 ? o : undefined)
        validation = await fetchWorkoutValidation(cachedProfile, candidate)

        if (validation.immediate_corrections?.length) {
          candidate = applyImmediateCorrectionsToWorkout(candidate, validation.immediate_corrections).workout
          validation = await fetchWorkoutValidation(cachedProfile, candidate)
        }
      }

      setAdjustedWorkoutCandidate(candidate)
      setAdjustedValidation(validation)
      setSelectedWorkoutVersion('original')
      if (validation.verdict === 'pass') {
        showToast('LLM-approved alternative ready. Choose between original and adjusted.', 'success')
      } else {
        showToast('Alternative generated with LLM guidance. Compare both versions.', 'info')
      }
    } catch (err) {
      logError('LLM-adjusted regeneration failed', err)
      showToast('Failed to regenerate with LLM adjustments', 'error')
    } finally {
      setRegeneratingWithLlm(false)
    }
  }

  const estimateDisplayedMinutesForDay = (day: any): number => {
    if (!day || day.isRestDay) return 0
    const pw = day.plannedWorkout
    if (!pw) return day.estimatedMinutes || 0
    // Prefer engine-produced totals; fallback estimators are lossy and can
    // under-report long sessions.
    if (Number.isFinite(pw.estimatedDurationMinutes) && Number(pw.estimatedDurationMinutes) > 0) {
      return Math.round(Number(pw.estimatedDurationMinutes))
    }
    if (Number.isFinite(day.estimatedMinutes) && Number(day.estimatedMinutes) > 0) {
      return Math.round(Number(day.estimatedMinutes))
    }
    const fromExerciseMinutes = Array.isArray(pw.exercises)
      ? Math.round(pw.exercises.reduce((sum: number, ex: any) => sum + (Number(ex?.estimatedMinutes) || 0), 0))
      : 0
    if (fromExerciseMinutes > 0) return fromExerciseMinutes
    const roughFromPrescription = Array.isArray(pw.exercises)
      ? Math.round(pw.exercises.reduce((sum: number, ex: any) => {
          if (ex?.isCardio) return sum + Math.max(5, Math.round((Number(ex.cardioDurationSeconds) || 0) / 60)) + 2
          const sets = Math.max(1, Number(ex?.sets) || 0)
          const warmups = Array.isArray(ex?.warmupSets) ? ex.warmupSets.length : 0
          const totalSets = sets + warmups
          const repSeconds = ex?.exerciseRole === 'primary' ? 45 : ex?.exerciseRole === 'secondary' ? 38 : 32
          const workMinutes = (totalSets * repSeconds) / 60
          const restMinutes = (Math.max(0, sets - 1) * Math.max(30, Number(ex?.restSeconds) || 60)) / 60
          const warmupMinutes = warmups * 0.5
          return sum + Math.max(3, Math.round(workMinutes + restMinutes + warmupMinutes))
        }, 0))
      : 0
    if (roughFromPrescription > 0) return roughFromPrescription
    return 0
  }

  const regenerateSelectedPlanDay = async () => {
    if (!weeklyPlan || !cachedProfile || !selectedPlanDate || !user) return
    const selected = weeklyPlan.days.find(d => d.planDate === selectedPlanDate)
    if (!selected || selected.isRestDay || selected.dayStatus === 'completed') return
    setRegeneratingDay(true)
    try {
      const today = getLocalDate()
      const duration = durationOverride ?? defaultDuration
      const overrides: SessionOverrides = {
        planningDate: selected.planDate,
        durationMinutes: duration,
      }
      if (selected.planDate === today && finishByTime) {
        overrides.finishByTime = finishByTime
      }
      let nextWorkout = await generateWorkout(cachedProfile, overrides)

      // Run LLM validation immediately for the selected day and apply immediate corrections.
      let dayVerdict: 'pass' | 'minor_issues' | 'major_issues' | 'pending' = 'pending'
      let dayCorrections: any[] = []
      try {
        const validation = await fetchWorkoutValidation(cachedProfile, nextWorkout)
        dayVerdict = validation.verdict
        dayCorrections = validation.immediate_corrections ?? []
        if (dayCorrections.length > 0) {
          nextWorkout = applyImmediateCorrectionsToWorkout(nextWorkout, dayCorrections).workout
        }
      } catch {
        // non-fatal
      }

      const prevWorkout = selected.plannedWorkout ?? null
      const updatedDay: WeeklyPlanDay = {
        ...selected,
        plannedWorkout: nextWorkout,
        estimatedExercises: nextWorkout.exercises.length,
        estimatedMinutes: Math.round(nextWorkout.exercises.reduce((s, ex) => s + (ex.estimatedMinutes || 0), 0)),
        llmVerdict: dayVerdict,
        llmCorrections: dayCorrections,
        dayStatus: 'adapted',
      }
      const updatedPlan: WeeklyPlan = {
        ...weeklyPlan,
        days: weeklyPlan.days.map(d => d.planDate === selected.planDate ? updatedDay : d),
      }
      setWeeklyPlan(updatedPlan)

      const beforeNames = new Set((prevWorkout?.exercises ?? []).map((e: any) => String(e.exerciseName || '').toLowerCase()))
      const afterNames = new Set((nextWorkout?.exercises ?? []).map((e: any) => String(e.exerciseName || '').toLowerCase()))
      const changedExercises = [...afterNames].filter(n => !beforeNames.has(n)).slice(0, 6)
      const diff = {
        planDate: selected.planDate,
        reasonCodes: ['manual_regen', 'objective_utility'],
        beforeWorkout: prevWorkout,
        afterWorkout: nextWorkout,
        diffSummary: {
          exerciseCountDelta: (nextWorkout?.exercises?.length ?? 0) - (prevWorkout?.exercises?.length ?? 0),
          estimatedMinutesDelta: (nextWorkout?.estimatedDurationMinutes ?? 0) - (prevWorkout?.estimatedDurationMinutes ?? 0),
          changedExercises,
        },
      }
      setWeeklyDiffsByDate(prev => ({ ...prev, [selected.planDate]: diff }))

      await saveWeeklyPlanToSupabase(user.id, updatedPlan, [diff]).catch(() => null)
      showToast(`${selected.dayName} regenerated`, 'success')
    } catch (err) {
      logError('Selected day regeneration error', err)
      showToast('Day regeneration failed', 'error')
    } finally {
      setRegeneratingDay(false)
    }
  }

  const toggleRestDay = async (dow: number) => {
    if (!user) return
    const next = restDays.includes(dow)
      ? restDays.filter(d => d !== dow)
      : [...restDays, dow].sort()
    setRestDays(next)

    if (cachedProfile) {
      const hasDoneToday = !!completedWorkout
      setWeekPreview(generateWeekPreview(
        cachedProfile,
        next,
        hasDoneToday,
        completedWorkout ? deriveWorkoutName(completedWorkout) : undefined
      ))
      if (weeklyPlan) {
        const recomputed = await recomputeWeeklyPlanWithDiff(weeklyPlan, cachedProfile, next)
        const withVerdicts = await annotateWeeklyPlanVerdicts(cachedProfile, recomputed.plan)
        const withActuals = await attachActualWeekWorkouts(withVerdicts)
        setWeeklyPlan(withActuals)
        const diffMap: Record<string, any> = {}
        for (const d of recomputed.diffs) diffMap[d.planDate] = d
        setWeeklyDiffsByDate(diffMap)
        if (user) {
          await saveWeeklyPlanToSupabase(user.id, withActuals, recomputed.diffs).catch(() => null)
        }
      }
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
      } catch (err) { logError('Failed to save exercise swap', err) }
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
      setOriginalWorkout(w)
      setAdjustedWorkoutCandidate(null)
      setAdjustedValidation(null)
      setSelectedWorkoutVersion('original')
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

  const runWorkoutReview = async () => {
    if (!workout || !profile || reviewLoading) return
    setReviewLoading(true)
    setReviewError(null)
    try {
      const result = await fetchWorkoutReview(profile, workout)
      setWorkoutReview(result)
    } catch (err: any) {
      logError('Workout review failed', err)
      setReviewError(err?.message || 'Failed to get workout review')
    } finally {
      setReviewLoading(false)
    }
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
      // Build warmup sets from engine prescription
      const warmupRows = (ex.warmupSets || []).map((ws: any, wi: number) => ({
        set_number: wi + 1,
        target_weight: ws.weight,
        target_reps: ws.reps,
        weight: String(ws.weight),
        reps: String(ws.reps),
        _is_warmup: true,
        _is_bodyweight: false,
      }))

      const workingRows = Array.from({ length: ex.sets }, (_, i) => ({
        set_number: warmupRows.length + i + 1,
        target_weight: ex.isBodyweight ? null : ex.targetWeight,
        target_reps: ex.targetReps,
        target_time_seconds: ex.targetTimeSeconds ?? null,
        target_time: ex.targetTimeSeconds != null ? String(ex.targetTimeSeconds) : '',
        tempo: ex.tempo,
        _is_bodyweight: ex.isBodyweight,
        weight: ex.isBodyweight ? 'BW' : (ex.targetWeight != null ? String(ex.targetWeight) : ''),
        reps: ex.targetTimeSeconds != null ? '' : String(ex.targetReps),
        time: '',
        time_seconds: '',
      }))

      return {
        name: ex.exerciseName,
        body_part: ex.bodyPart,
        exercise_library_id: ex.exerciseLibraryId,
        category: 'Strength',
        _prescription: prescription,
        sets: [...warmupRows, ...workingRows],
      }
    })

    const workoutName = workout.exercises.length > 0
      ? workout.exercises.map(e => e.targetMuscleGroup).filter((v, i, a) => a.indexOf(v) === i).map(g => g.replace(/_/g, ' ')).slice(0, 3).join(', ')
      : 'Generated Workout'

    sessionStorage.setItem('generated_workout', JSON.stringify({
      exercises,
      generated_workout_id: workout.id,
      sessionRationale: workout.sessionRationale,
      templateName: workoutName,
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

  const toggleWhy = (idx: number) => {
    setExpandedWhy(prev => {
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

  const renderWeeklyPlanCards = () => {
    if (!weeklyPlan || weeklyPlan.days.length === 0) return null
    const today = getLocalDate()
    const selectedDay = weeklyPlan.days.find(d => d.planDate === selectedPlanDate) || weeklyPlan.days[0]
    if (!selectedDay) return null
    const selectedDiff = selectedDay ? weeklyDiffsByDate[selectedDay.planDate] : null
    const selectedVerdict = selectedDay
      ? (selectedDay.planDate === today
        ? (llmValidation?.verdict ?? selectedDay.llmVerdict ?? 'pending')
        : (selectedDay.llmVerdict ?? 'pending'))
      : 'pending'
    const selectedVerdictColor =
      selectedVerdict === 'pass' ? 'var(--success)'
        : selectedVerdict === 'minor_issues' ? '#e6a800'
          : selectedVerdict === 'major_issues' ? 'var(--danger)'
            : 'var(--text-tertiary)'

    return (
      <div className={styles.weekPreview}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className={styles.weekPreviewTitle}>Weekly Plan (Adaptive)</h3>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Select a day to inspect planned vs actual</span>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
          {weeklyPlan.days.map(day => {
            const selected = day.planDate === selectedDay.planDate
            const dayStatus = day.dayStatus || (day.actualWorkoutId ? 'completed' : 'planned')
            const shownMinutes = estimateDisplayedMinutesForDay(day)
            return (
              <button
                key={day.planDate}
                onClick={() => setSelectedPlanDate(day.planDate)}
                style={{
                  padding: '8px 10px',
                  minWidth: 86,
                  borderRadius: 8,
                  border: selected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  background: selected ? 'var(--surface-elevated)' : 'var(--surface-card)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  flexShrink: 0,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 12 }}>{day.dayName.slice(0, 3)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{day.planDate.slice(5)}</div>
                <div style={{ fontSize: 11, color: dayStatus === 'completed' ? 'var(--success)' : 'var(--text-secondary)' }}>
                  {dayStatus === 'completed' ? 'completed' : day.isRestDay ? 'rest' : `${shownMinutes}m`}
                </div>
              </button>
            )
          })}
        </div>
        {!selectedDay.isRestDay && selectedDay.dayStatus !== 'completed' && (
          <div style={{ marginTop: 8 }}>
            <Button variant="secondary" onClick={regenerateSelectedPlanDay} loading={regeneratingDay} style={{ width: '100%' }}>
              Regenerate {selectedDay.dayName}
            </Button>
          </div>
        )}
        <div className={styles.contextCard} style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong>{selectedDay.dayName}</strong>
            <span style={{ color: selectedDay.isRestDay ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
              {selectedDay.isRestDay ? 'Rest' : `${selectedDay.estimatedExercises} exercises · ${estimateDisplayedMinutesForDay(selectedDay)}m`}
            </span>
            <span style={{ color: selectedVerdictColor, fontSize: 12 }}>LLM: {selectedVerdict}</span>
            {selectedDiff && <span style={{ fontSize: 11, color: '#e6a800' }}>Updated</span>}
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Status: {selectedDay.dayStatus || (selectedDay.actualWorkoutId ? 'completed' : 'planned')}
            </span>
          </div>
          {selectedDay.isRestDay ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Recovery day.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {selectedDay.actualWorkout ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>Actual workout completed</div>
                  {(selectedDay.actualWorkout.workout_exercises ?? []).map((ex: any, idx: number) => {
                    const sets = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
                    const warmups = sets.filter((s: any) => s?.is_warmup === true)
                    const working = sets.filter((s: any) => s?.is_warmup !== true)
                    return (
                      <div key={`${selectedDay.planDate}-actual-${idx}`} style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                        <div style={{ fontWeight: 600 }}>{ex.exercise_name}</div>
                        <div style={{ color: 'var(--text-secondary)' }}>
                          {working.length > 0 ? `${working.length} working sets` : `${sets.length} sets`}
                        </div>
                        {working.length > 0 && (
                          <div style={{ color: 'var(--text-secondary)' }}>
                            {working.map((s: any) => `${s.weight || '-'}x${s.reps || '-'}`).join(' | ')}
                          </div>
                        )}
                        {warmups.length > 0 && (
                          <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
                            Warmup: {warmups.map((s: any) => `${s.weight || '-'}x${s.reps || '-'}`).join(' -> ')}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>Planned workout</div>
                  {(selectedDay.plannedWorkout?.exercises ?? []).map((ex: any, idx: number) => (
                    <div key={`${selectedDay.planDate}-${idx}`} style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                      <div style={{ fontWeight: 600 }}>{ex.exerciseName}</div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {ex.isCardio
                          ? `${Math.round((ex.cardioDurationSeconds ?? 1800) / 60)} min cardio`
                          : ex.targetTimeSeconds != null
                            ? `${ex.sets} x ${Math.round(ex.targetTimeSeconds)}s hold${ex.targetRir != null ? ` (RIR ${ex.targetRir})` : ''}`
                            : `${ex.sets} x ${ex.targetReps}${ex.targetWeight ? ` @ ${ex.targetWeight} lb` : ''}${ex.targetRir != null ? ` (RIR ${ex.targetRir})` : ''}`}
                      </div>
                      {Array.isArray(ex.warmupSets) && ex.warmupSets.length > 0 && (
                        <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
                          Warmup: {ex.warmupSets.map((w: any) => `${w.weight}x${w.reps}`).join(' -> ')}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
              {selectedDiff && (
                <div style={{ fontSize: 12, padding: '8px', background: 'var(--surface-elevated)', borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Why changed</div>
                  <div style={{ color: 'var(--text-secondary)' }}>Reasons: {(selectedDiff.reasonCodes || []).join(', ') || 'context update'}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Deltas: {selectedDiff.diffSummary?.exerciseCountDelta ?? 0} exercises, {selectedDiff.diffSummary?.estimatedMinutesDelta ?? 0} min
                  </div>
                  {Array.isArray(selectedDiff.diffSummary?.changedExercises) && selectedDiff.diffSummary.changedExercises.length > 0 && (
                    <div style={{ color: 'var(--text-secondary)' }}>Changed: {selectedDiff.diffSummary.changedExercises.join(', ')}</div>
                  )}
                </div>
              )}
              {selectedVerdict !== 'pass' && Array.isArray(selectedDay.llmCorrections) && selectedDay.llmCorrections.length > 0 && (
                <div style={{ fontSize: 12, padding: '8px', borderRadius: 8, background: 'var(--surface-warning, #2f2410)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>LLM Issues</div>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
                    {selectedVerdict === 'major_issues'
                      ? 'Major issues means the plan has high-impact logic/safety mismatches and should be regenerated or corrected.'
                      : 'Minor issues means quality mismatches that should be corrected before training.'}
                  </div>
                  {selectedDay.llmCorrections.map((c: any, ci: number) => (
                    <div key={ci} style={{ color: 'var(--text-secondary)' }}>
                      {c.exerciseName}: {c.issue} {'->'} {c.fix}{typeof c.newValue === 'number' ? ` ${c.newValue}` : ''} ({c.reason})
                    </div>
                  ))}
                </div>
              )}
              {selectedDay.planDate === today && llmValidation?.immediate_corrections?.length ? (
                <div style={{ fontSize: 12, padding: '8px', borderRadius: 8, background: 'var(--surface-warning, #2f2410)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>LLM Corrections Suggested</div>
                  {llmValidation.immediate_corrections.map((c, ci) => (
                    <div key={ci} style={{ color: 'var(--text-secondary)' }}>
                      {c.exerciseName}: {c.fix} ({c.issue}) - {c.reason}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    )
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

  if (viewState === 'completed' && completedWorkout) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <BackButton fallbackPath="/" />
          <h1>Today's Workout</h1>
          <div style={{ width: 32 }} />
        </div>

        <div className={styles.content} style={{ paddingTop: 'var(--space-lg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className={s.card} style={{ padding: 'var(--space-lg)' }}>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--success)' }}>✓ Workout Completed</div>
            <p style={{ color: 'var(--text-secondary)', margin: '0 0 4px' }}>
              {deriveWorkoutName(completedWorkout)} — {Math.round(completedWorkout.duration / 60)} min
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              You already trained today. Rest up and come back tomorrow.
            </p>
          </div>
          <div style={{ marginTop: 16 }}>
            <Button variant="secondary" onClick={() => {
              forceGenerateRef.current = true
              setViewState('loading')
              initialLoad()
            }}>
              Generate Another Workout Anyway
            </Button>
          </div>
        </div>

        {renderWeeklyPlanCards()}
        </div>

        {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
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
              <h3 className={styles.weekPreviewTitle}>Rest Day Overrides</h3>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Tap to toggle rest/workout (navigator is below)</span>
            </div>
            <div className={styles.weekDays}>
              {weekPreview.map(day => {
                const isRest = restDays.includes(day.dayOfWeek) || (restDays.length === 0 && day.isRestDay)
                return (
                  <div
                    key={day.dayOfWeek}
                    className={`${styles.weekDay} ${day.isToday ? styles.weekDayToday : ''} ${isRest ? styles.weekDayRest : ''}`}
                    onClick={() => !day.isCompleted && toggleRestDay(day.dayOfWeek)}
                    style={{ cursor: day.isCompleted ? 'default' : 'pointer', userSelect: 'none' }}
                  >
                    <div className={styles.weekDayName}>{day.dayName.slice(0, 3)}</div>
                    <div className={styles.weekDayFocus} style={day.isCompleted ? { color: 'var(--success)' } : undefined}>
                      {day.isCompleted ? `✓ ${day.focus}` : isRest ? 'Rest' : (day.focus || (day.muscleGroups.length > 0 ? day.muscleGroups.slice(0, 2).map(g => g.replace(/_/g, ' ')).join(', ') : 'Full Body'))}
                    </div>
                    {!isRest && !day.isCompleted && day.muscleGroups.length > 0 && (
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

        {renderWeeklyPlanCards()}

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
                            {ex.targetTimeSeconds != null ? `${ex.sets} × ${Math.round(ex.targetTimeSeconds)}s hold` : `${ex.sets} × ${ex.targetReps}`}
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

                    {/* D3: Inline decision breakdown */}
                    <div className={styles.whySection}>
                      <div
                        className={styles.whyToggle}
                        onClick={(e) => { e.stopPropagation(); toggleWhy(idx) }}
                      >
                        <span>{expandedWhy.has(idx) ? '▾' : '▸'} Why this exercise?</span>
                      </div>
                      {expandedWhy.has(idx) && (() => {
                        const decision = workout.exerciseDecisions.find(
                          d => d.exerciseName.toLowerCase() === ex.exerciseName.toLowerCase()
                        )
                        const competitors = workout.exerciseDecisions
                          .filter(d => d.muscleGroup === (ex.targetMuscleGroup ?? ''))
                          .sort((a, b) => b.score - a.score)
                        const rank = competitors.findIndex(
                          d => d.exerciseName.toLowerCase() === ex.exerciseName.toLowerCase()
                        )
                        return (
                          <div className={styles.whyContent}>
                            {/* D3.2: Why this exercise */}
                            {decision && (
                              <>
                                <div className={styles.whyLabel}>Why this exercise (score: {decision.score}, rank #{rank + 1} of {competitors.length})</div>
                                {decision.factors.map((f, fi) => (
                                  <div key={fi} className={styles.whyFactor}>{f}</div>
                                ))}
                                {competitors.length > 1 && (
                                  <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                    Other candidates: {competitors.filter(c => c.exerciseName.toLowerCase() !== ex.exerciseName.toLowerCase()).map(c => `${c.exerciseName} (${c.score})`).join(', ')}
                                  </div>
                                )}
                              </>
                            )}

                            {/* D3.3: Why these sets */}
                            {!ex.isCardio && profile && (() => {
                              const vol = profile.muscleVolumeStatuses.find(
                                v => v.muscleGroup.toLowerCase() === (ex.targetMuscleGroup ?? '').toLowerCase()
                              )
                              const freq = profile.muscleGroupFrequency[(ex.targetMuscleGroup ?? '').toLowerCase()] ?? 0
                              return vol ? (
                                <>
                                  <div className={styles.whyLabel}>Why {ex.sets} sets</div>
                                  <div className={styles.whyFactor}>
                                    <span>Volume status</span>
                                    <span>{vol.status.replace(/_/g, ' ')} ({vol.weeklyDirectSets} / {vol.mavLow}–{vol.mavHigh} MAV)</span>
                                  </div>
                                  <div className={styles.whyFactor}>
                                    <span>Weekly frequency</span>
                                    <span>{freq.toFixed(1)}×/wk</span>
                                  </div>
                                  <div className={styles.whyFactor}>
                                    <span>Per-session ceiling</span>
                                    <span>{freq > 0 ? Math.round(vol.mavHigh / freq) : vol.mavHigh} sets (MAV ÷ freq)</span>
                                  </div>
                                  <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                    SFR curve: additional sets give diminishing stimulus (Krieger 2010). Below MEV → more sets prioritized; approaching MRV → engine prefers variety.
                                  </div>
                                </>
                              ) : null
                            })()}

                            {/* D3.4: Why this weight */}
                            {!ex.isCardio && ex.targetWeight != null && profile && (() => {
                              const prog = profile.exerciseProgressions.find(
                                p => p.exerciseName.toLowerCase() === ex.exerciseName.toLowerCase()
                              )
                              return prog ? (
                                <>
                                  <div className={styles.whyLabel}>Why {ex.targetWeight} lbs</div>
                                  <div className={styles.whyFactor}>
                                    <span>Estimated 1RM</span>
                                    <span>{Math.round(prog.estimated1RM)} lbs</span>
                                  </div>
                                  <div className={styles.whyFactor}>
                                    <span>Best set (Epley input)</span>
                                    <span>{prog.bestSet.weight} lbs × {prog.bestSet.reps} reps</span>
                                  </div>
                                  <div className={styles.whyFactor}>
                                    <span>Epley formula</span>
                                    <span>{prog.bestSet.weight} × (1 + {prog.bestSet.reps}/30) = {Math.round(prog.bestSet.weight * (1 + prog.bestSet.reps / 30))}</span>
                                  </div>
                                  {ex.targetTimeSeconds != null ? (
                                    <div className={styles.whyFactor}>
                                      <span>Target: {Math.round(ex.targetTimeSeconds)}s hold @ RIR {ex.targetRir ?? '—'}</span>
                                      <span>Bodyweight hold</span>
                                    </div>
                                  ) : (
                                    <div className={styles.whyFactor}>
                                      <span>Target: {ex.targetReps} reps @ RIR {ex.targetRir ?? '—'}</span>
                                      <span>→ {ex.targetWeight} lbs (rounded to 5)</span>
                                    </div>
                                  )}
                                  <div className={styles.whyFactor}>
                                    <span>Last working weight</span>
                                    <span>{prog.lastWeight} lbs</span>
                                  </div>
                                  <div className={styles.whyFactor}>
                                    <span>Progression</span>
                                    <span>{prog.status} ({prog.sessionsTracked} sessions, {prog.progressionPattern})</span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className={styles.whyLabel}>Why {ex.targetWeight} lbs</div>
                                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                    No progression data yet — weight based on table defaults or user preference.
                                  </div>
                                </>
                              )
                            })()}

                            {/* D3.6: LLM notes */}
                            {llmValidation && (() => {
                              const corrections = (llmValidation.immediate_corrections || []).filter(
                                c => c.exerciseName.toLowerCase() === ex.exerciseName.toLowerCase()
                              )
                              const observations = (llmValidation.pattern_observations || []).filter(
                                o => (o.pattern + ' ' + o.suggestion).toLowerCase().includes(ex.exerciseName.toLowerCase())
                              )
                              if (corrections.length === 0 && observations.length === 0) return null
                              return (
                                <>
                                  <div className={styles.whyLabel}>LLM Notes</div>
                                  {corrections.map((c, ci) => (
                                    <div key={ci} className={styles.whyFactor} style={{ color: 'var(--text-warning, #ffa726)' }}>
                                      <span>{c.fix}: {c.issue}</span>
                                      <span>{c.reason}</span>
                                    </div>
                                  ))}
                                  {observations.map((o, oi) => (
                                    <div key={oi} style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                      <span style={{ fontWeight: 600 }}>{o.pattern}</span> — {o.suggestion} ({o.confidence})
                                    </div>
                                  ))}
                                </>
                              )
                            })()}
                          </div>
                        )
                      })()}
                    </div>

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
                    const isSelected = workout.exercises.some(e => (e.exerciseName || '').toLowerCase() === (d.exerciseName || '').toLowerCase());
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

        {/* AI Workout Review */}
        <div className={s.card} style={{ marginBottom: 12 }}>
          {llmValidation && llmValidation.verdict !== 'pass' && (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 8, background: 'var(--surface-warning, #2f2410)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                LLM flags this workout ({llmValidation.verdict})
              </div>
              <Button
                variant="secondary"
                onClick={regenerateWithLlmAdjustments}
                loading={regeneratingWithLlm}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                Regenerate with LLM Adjustments
              </Button>
            </div>
          )}

          {originalWorkout && adjustedWorkoutCandidate && (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Choose workout version</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant={selectedWorkoutVersion === 'original' ? 'primary' : 'secondary'}
                  onClick={() => {
                    setWorkout(originalWorkout)
                    setSelectedWorkoutVersion('original')
                  }}
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  Use Original ({Math.round(originalWorkout.estimatedDurationMinutes || 0)}m)
                </Button>
                <Button
                  variant={selectedWorkoutVersion === 'adjusted' ? 'primary' : 'secondary'}
                  onClick={() => {
                    setWorkout(adjustedWorkoutCandidate)
                    setSelectedWorkoutVersion('adjusted')
                  }}
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  Use LLM-Adjusted ({Math.round(adjustedWorkoutCandidate.estimatedDurationMinutes || 0)}m{adjustedValidation ? `, ${adjustedValidation.verdict}` : ''})
                </Button>
              </div>
            </div>
          )}

          {!workoutReview && !reviewLoading && !reviewError && (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <Button variant="secondary" onClick={runWorkoutReview} style={{ fontSize: 13, padding: '6px 16px' }}>
                AI Workout Review
              </Button>
            </div>
          )}
          {reviewLoading && (
            <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Analyzing workout...
            </div>
          )}
          {reviewError && (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{reviewError}</p>
              <Button variant="secondary" onClick={runWorkoutReview} style={{ fontSize: 12, padding: '4px 12px' }}>Retry</Button>
            </div>
          )}
          {workoutReview && (() => {
            const verdictConfig: Record<string, { color: string; label: string }> = {
              well_programmed: { color: 'var(--success)', label: 'Well Programmed' },
              acceptable: { color: '#e6a800', label: 'Acceptable' },
              has_concerns: { color: '#f59e0b', label: 'Has Concerns' },
              problematic: { color: '#ef4444', label: 'Problematic' },
            }
            const vc = verdictConfig[workoutReview.verdict] || verdictConfig.acceptable
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>AI Review</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: vc.color, padding: '2px 8px', borderRadius: 4, backgroundColor: `${vc.color}20` }}>{vc.label}</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
                  {workoutReview.summary}
                </p>
                {workoutReview.observations?.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {workoutReview.observations.map((o, i) => {
                      const oColor = o.sentiment === 'positive' ? 'var(--success)' : o.sentiment === 'concern' ? '#f59e0b' : 'var(--text-muted)'
                      return (
                        <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, paddingLeft: 10, borderLeft: `2px solid ${oColor}` }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{o.aspect.replace(/_/g, ' ')}:</span>{' '}
                          {o.note}
                        </div>
                      )
                    })}
                  </div>
                )}
                {workoutReview.expectedStimulus && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    <strong style={{ color: 'var(--text-secondary)' }}>Stimulus:</strong> {workoutReview.expectedStimulus}
                  </div>
                )}
                {workoutReview.recoveryImpact && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <strong style={{ color: 'var(--text-secondary)' }}>Recovery:</strong> {workoutReview.recoveryImpact}
                  </div>
                )}
              </div>
            )
          })()}
        </div>

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
