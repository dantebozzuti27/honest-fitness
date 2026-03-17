import { requireSupabase } from './supabase'
import { apiUrl } from './urlConfig'
import { logError } from '../utils/logger'

export interface TrainingSummary {
  overallAssessment: string
  keyFindings: {
    category: string
    title: string
    detail: string
    sentiment: 'positive' | 'neutral' | 'warning' | 'negative'
  }[]
  blindSpots: string[]
  dataQuality: string
}

export interface WorkoutReview {
  verdict: 'well_programmed' | 'acceptable' | 'has_concerns' | 'problematic'
  summary: string
  observations: {
    aspect: string
    note: string
    sentiment: 'positive' | 'neutral' | 'concern'
  }[]
  expectedStimulus: string
  recoveryImpact: string
}

async function getAuthToken(): Promise<string> {
  const supabase = requireSupabase()
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Not authenticated')
  return token
}

function sanitizeProfile(profile: any): any {
  if (!profile) return profile
  const {
    consistencyScore, trainingFrequency, avgSessionDuration, trainingAgeDays,
    strengthIndex, relativeStrength, readinessScore, readinessZone,
    detectedSplit, rolling30DayTrends, exerciseProgressions, muscleVolumeStatuses,
    goalProgress, athleteProfile, fitnessFatigueModel,
    bodyWeightTrend, restingHR, hrv, sleepScore, age,
  } = profile

  return {
    consistencyScore, trainingFrequency, avgSessionDuration, trainingAgeDays,
    strengthIndex, relativeStrength, readinessScore, readinessZone,
    detectedSplit: detectedSplit ? { type: detectedSplit.type, typicalRotation: detectedSplit.typicalRotation } : null,
    rolling30DayTrends,
    exerciseProgressions: Array.isArray(exerciseProgressions)
      ? exerciseProgressions.slice(0, 15).map((p: any) => ({
          name: p.exerciseName, status: p.status, slope: p.progressionSlope,
          sessions: p.sessionsTracked, pattern: p.progressionPattern,
          lastWeight: p.lastWeight, estimated1RM: p.estimated1RM,
        }))
      : null,
    muscleVolumeStatuses: Array.isArray(muscleVolumeStatuses)
      ? muscleVolumeStatuses.map((s: any) => ({
          group: s.muscleGroup, status: s.status, weeklyVolume: s.weeklyDirectSets
        }))
      : null,
    goalProgress: goalProgress ? {
      goalLabel: goalProgress.goalLabel, overallScore: goalProgress.overallScore,
      summary: goalProgress.summary
    } : null,
    athleteProfile: athleteProfile ? {
      summary: athleteProfile.summary,
      overallScore: athleteProfile.overallScore,
      items: (athleteProfile.items || []).slice(0, 10).map((item: any) => ({
        category: item.category, area: item.area, detail: item.detail, priority: item.priority,
      })),
    } : null,
    fitnessFatigueModel: fitnessFatigueModel ? {
      fitness: fitnessFatigueModel.fitness, fatigue: fitnessFatigueModel.fatigue,
      form: fitnessFatigueModel.form
    } : null,
    bodyWeightTrend, restingHR, hrv, sleepScore, age,
  }
}

export async function fetchTrainingSummary(trainingProfile: any): Promise<TrainingSummary> {
  const token = await getAuthToken()
  const sanitized = sanitizeProfile(trainingProfile)

  const res = await fetch(apiUrl('/api/insights'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'summary', trainingProfile: sanitized }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Request failed (${res.status})`)
  }

  const json = await res.json()
  if (!json.success) throw new Error(json.error?.message || 'Unknown error')
  return json.data as TrainingSummary
}

export interface WorkoutValidation {
  schema_version?: 'v1'
  rejection_classes?: string[]
  immediate_corrections: {
    exerciseName: string
    issue: string
    fix: 'sets' | 'weight' | 'remove' | 'reorder'
    newValue: number | null
    reason: string
  }[]
  pattern_observations: {
    pattern: string
    suggestion: string
    confidence: 'high' | 'medium' | 'low'
  }[]
  verdict: 'pass' | 'minor_issues' | 'major_issues'
}

export async function fetchWorkoutValidation(trainingProfile: any, workoutData: any): Promise<WorkoutValidation> {
  const token = await getAuthToken()

  const exercises = workoutData.exercises || []
  const workoutSummary = {
    id: workoutData.id ?? null,
    estimatedDurationMinutes: workoutData.estimatedDurationMinutes,
    trainingGoal: workoutData.trainingGoal,
    exercises: exercises.map((ex: any) => ({
      exerciseName: ex.exerciseName,
      bodyPart: ex.bodyPart,
      targetMuscleGroup: ex.targetMuscleGroup,
      role: ex.exerciseRole,
      sets: typeof ex.sets === 'number' ? ex.sets : (Array.isArray(ex.sets) ? ex.sets.length : 0),
      targetReps: ex.targetReps ?? null,
      targetWeight: ex.targetWeight ?? null,
      targetRir: ex.targetRir ?? null,
      restSeconds: ex.restSeconds ?? null,
      isCardio: ex.isCardio,
      adjustments: ex.adjustments,
    })),
  }

  const res = await fetch(apiUrl('/api/insights'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'validate-workout', trainingProfile, workoutData: workoutSummary }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Request failed (${res.status})`)
  }

  const json = await res.json()
  if (!json.success) throw new Error(json.error?.message || 'Unknown error')
  const data = json.data as WorkoutValidation
  // Contract discipline: only accept known schema versions.
  if (data?.schema_version && data.schema_version !== 'v1') {
    throw new Error(`Unsupported validation schema version: ${data.schema_version}`)
  }
  return data
}

export async function fetchWorkoutReview(trainingProfile: any, workoutData: any): Promise<WorkoutReview> {
  const token = await getAuthToken()
  const sanitized = sanitizeProfile(trainingProfile)

  const exercises = workoutData.exercises || []
  const muscleGroups = [...new Set(exercises.map((ex: any) => ex.bodyPart).filter(Boolean))]
  const workoutSummary = {
    name: workoutData.name || muscleGroups.slice(0, 3).join(', ') || 'Generated Workout',
    estimatedDurationMinutes: workoutData.estimatedDurationMinutes,
    trainingGoal: workoutData.trainingGoal,
    recoveryStatus: workoutData.recoveryStatus,
    deloadActive: workoutData.deloadActive,
    exercises: exercises.map((ex: any) => ({
      exerciseName: ex.exerciseName,
      bodyPart: ex.bodyPart,
      role: ex.exerciseRole || ex.role,
      isCardio: ex.isCardio,
      sets: typeof ex.sets === 'number' ? ex.sets : (Array.isArray(ex.sets) ? ex.sets.length : 0),
      prescription: {
        reps: ex.targetReps ?? null,
        weight: ex.targetWeight ?? null,
        rir: ex.targetRir ?? null,
      },
    })),
  }

  const res = await fetch(apiUrl('/api/insights'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'workout_review', trainingProfile: sanitized, workoutData: workoutSummary }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Request failed (${res.status})`)
  }

  const json = await res.json()
  if (!json.success) throw new Error(json.error?.message || 'Unknown error')
  return json.data as WorkoutReview
}
