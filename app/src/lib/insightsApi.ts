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
    exerciseProgressions: exerciseProgressions
      ? Object.entries(exerciseProgressions).slice(0, 15).map(([name, p]: [string, any]) => ({
          name, trend: p.trend, pctChange: p.percentageChange, sets: p.totalSets
        }))
      : null,
    muscleVolumeStatuses: muscleVolumeStatuses
      ? Object.entries(muscleVolumeStatuses).map(([mg, s]: [string, any]) => ({
          group: mg, status: s.status, weeklyVolume: s.weeklyVolume
        }))
      : null,
    goalProgress: goalProgress ? {
      goalLabel: goalProgress.goalLabel, overallScore: goalProgress.overallScore,
      summary: goalProgress.summary
    } : null,
    athleteProfile: athleteProfile ? {
      overallTier: athleteProfile.overallTier,
      strengthScore: athleteProfile.strengthScore,
      consistencyScore: athleteProfile.consistencyScore
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

export async function fetchWorkoutReview(trainingProfile: any, workoutData: any): Promise<WorkoutReview> {
  const token = await getAuthToken()
  const sanitized = sanitizeProfile(trainingProfile)

  const workoutSummary = {
    name: workoutData.name,
    estimatedDurationMinutes: workoutData.estimatedDurationMinutes,
    trainingGoal: workoutData.trainingGoal,
    recoveryStatus: workoutData.recoveryStatus,
    deloadActive: workoutData.deloadActive,
    exercises: (workoutData.exercises || []).map((ex: any) => ({
      exerciseName: ex.exerciseName,
      bodyPart: ex.bodyPart,
      role: ex.role,
      isCardio: ex.isCardio,
      sets: ex.sets?.length || 0,
      prescription: ex.sets?.[0] ? {
        reps: ex.sets[0].targetReps,
        weight: ex.sets[0].targetWeight,
        rir: ex.sets[0].targetRIR,
      } : null,
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
