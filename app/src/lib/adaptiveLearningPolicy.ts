import type { TrainingProfile } from './trainingAnalysis'

export type GoalKind = 'strength' | 'hypertrophy' | 'general_fitness' | 'fat_loss' | 'endurance'
export type ExerciseRoleKind = 'primary' | 'secondary' | 'isolation' | 'corrective' | 'cardio'

export interface AdaptiveUserPreferences {
  training_goal: GoalKind
  experience_level: string | null
  age: number | null
}

export interface AdaptiveExercise {
  exerciseName: string
  exerciseRole: ExerciseRoleKind
  isCardio: boolean
  sets: number
  targetReps: number
  restSeconds: number
  targetRir: number | null
  cardioDurationSeconds: number | null
  targetHrZone: number | null
  adjustments: string[]
}

type RolePriors = {
  setRange: [number, number]
  repRange: [number, number]
  restRangeSec: [number, number]
  rirRange: [number, number]
}

export interface ScientificPriors {
  priorsVersion: string
  roleTargets: Record<ExerciseRoleKind, RolePriors>
  progressionSensitivity: number
  fatigueSensitivity: number
  adherenceSensitivity: number
}

export interface PersonalStateEstimate {
  stateVersion: string
  readiness: number
  fatigue: number
  adherence: number
  evidenceConfidence: number
  progressionSignal: number
}

export interface AdaptivePolicyContext {
  scientificPriors: ScientificPriors
  personalState: PersonalStateEstimate
  policyConfidence: number
  promoteReady: boolean
  rationale: string
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function defaultRoleTargets(goal: GoalKind): Record<ExerciseRoleKind, RolePriors> {
  const primaryStrength: RolePriors = { setRange: [3, 6], repRange: [3, 6], restRangeSec: [120, 240], rirRange: [1, 3] }
  const primaryHypertrophy: RolePriors = { setRange: [3, 5], repRange: [5, 10], restRangeSec: [90, 180], rirRange: [1, 3] }
  const secondary: RolePriors = { setRange: [2, 5], repRange: [6, 12], restRangeSec: [75, 150], rirRange: [1, 3] }
  const isolation: RolePriors = { setRange: [2, 5], repRange: [8, 20], restRangeSec: [45, 120], rirRange: [0, 3] }
  const corrective: RolePriors = { setRange: [2, 4], repRange: [10, 20], restRangeSec: [30, 90], rirRange: [2, 4] }
  const cardio: RolePriors = { setRange: [1, 2], repRange: [1, 1], restRangeSec: [0, 45], rirRange: [0, 0] }

  const primary = goal === 'strength' ? primaryStrength : primaryHypertrophy
  return { primary, secondary, isolation, corrective, cardio }
}

export function buildScientificPriors(prefs: AdaptiveUserPreferences): ScientificPriors {
  const goal = prefs.training_goal || 'hypertrophy'
  const exp = String(prefs.experience_level || 'intermediate').toLowerCase()
  const age = Number(prefs.age || 30)

  const progressionSensitivity = clamp(
    (goal === 'strength' ? 0.72 : 0.6) + (exp === 'advanced' || exp === 'elite' ? 0.08 : 0) - (age > 35 ? 0.05 : 0),
    0.45,
    0.85
  )
  const fatigueSensitivity = clamp((age > 35 ? 0.7 : 0.58) + (exp === 'beginner' ? 0.08 : 0), 0.45, 0.85)
  const adherenceSensitivity = clamp(goal === 'fat_loss' ? 0.72 : 0.62, 0.45, 0.85)

  return {
    priorsVersion: 'science_priors_v1',
    roleTargets: defaultRoleTargets(goal),
    progressionSensitivity,
    fatigueSensitivity,
    adherenceSensitivity,
  }
}

export function estimatePersonalState(profile: TrainingProfile): PersonalStateEstimate {
  const readiness = clamp(Number(profile.fitnessFatigueModel?.readiness ?? 0.5), 0, 1)
  const fatigue = clamp(1 - readiness, 0, 1)
  const adherence = clamp(Number(profile.canonicalModelContext?.adherenceScore ?? 0.5), 0, 1)
  const evidenceConfidence = clamp(Number(profile.canonicalModelContext?.evidenceConfidence ?? 0.5), 0, 1)
  const progressionScore = clamp(Number(profile.canonicalModelContext?.progressionScore ?? 0.5), 0, 1)
  const progressionSignal = clamp((progressionScore - 0.5) * 2, -1, 1)

  return {
    stateVersion: 'personal_state_v1',
    readiness,
    fatigue,
    adherence,
    evidenceConfidence,
    progressionSignal,
  }
}

export function buildAdaptivePolicyContext(profile: TrainingProfile, prefs: AdaptiveUserPreferences): AdaptivePolicyContext {
  const scientificPriors = buildScientificPriors(prefs)
  const personalState = estimatePersonalState(profile)
  const policyConfidence = clamp((personalState.evidenceConfidence * 0.65) + (personalState.adherence * 0.35), 0, 1)
  const promoteReady = policyConfidence >= 0.68 && personalState.adherence >= 0.6
  const rationale = `Adaptive policy (${scientificPriors.priorsVersion}) with confidence ${Math.round(policyConfidence * 100)}%`
  return { scientificPriors, personalState, policyConfidence, promoteReady, rationale }
}

export function optimizePrescription(exercises: AdaptiveExercise[], ctx: AdaptivePolicyContext): AdaptiveExercise[] {
  const pressure =
    (ctx.personalState.progressionSignal * ctx.scientificPriors.progressionSensitivity) +
    ((ctx.personalState.adherence - 0.5) * ctx.scientificPriors.adherenceSensitivity) -
    ((ctx.personalState.fatigue - 0.5) * ctx.scientificPriors.fatigueSensitivity)

  const progressionPressure = clamp(pressure, -0.35, 0.35)

  return exercises.map((ex) => {
    if (ex.isCardio) {
      const out = { ...ex, adjustments: [...(ex.adjustments || [])] }
      if (out.cardioDurationSeconds != null) {
        const cardioScale = clamp(1 + progressionPressure * 0.35, 0.85, 1.2)
        const nextDuration = Math.round(out.cardioDurationSeconds * cardioScale)
        if (nextDuration !== out.cardioDurationSeconds) {
          out.adjustments.push(`Adaptive cardio dose: ${Math.round(out.cardioDurationSeconds / 60)} -> ${Math.round(nextDuration / 60)} min`)
          out.cardioDurationSeconds = nextDuration
        }
      }
      return out
    }

    const priors = ctx.scientificPriors.roleTargets[ex.exerciseRole] || ctx.scientificPriors.roleTargets.secondary
    const out = { ...ex, adjustments: [...(ex.adjustments || [])] }

    const targetSetShift = progressionPressure >= 0.12 ? 1 : progressionPressure <= -0.12 ? -1 : 0
    const shiftedSets = out.sets + targetSetShift
    const boundedSets = clamp(shiftedSets, priors.setRange[0], priors.setRange[1])
    if (boundedSets !== out.sets) {
      out.adjustments.push(`Adaptive set progression: ${out.sets} -> ${boundedSets}`)
      out.sets = boundedSets
    }

    const adaptiveRepCenter = out.targetReps + Math.round(progressionPressure * 2)
    const boundedReps = clamp(adaptiveRepCenter, priors.repRange[0], priors.repRange[1])
    if (boundedReps !== out.targetReps) {
      out.adjustments.push(`Adaptive rep target: ${out.targetReps} -> ${boundedReps}`)
      out.targetReps = boundedReps
    }

    const adaptiveRest = Math.round(out.restSeconds * clamp(1 - (progressionPressure * 0.2), 0.85, 1.15))
    const boundedRest = clamp(adaptiveRest, priors.restRangeSec[0], priors.restRangeSec[1])
    if (boundedRest !== out.restSeconds) {
      out.adjustments.push(`Adaptive rest tuning: ${out.restSeconds}s -> ${boundedRest}s`)
      out.restSeconds = boundedRest
    }

    if (out.targetRir != null) {
      const rirCenter = out.targetRir + (progressionPressure > 0 ? -1 : progressionPressure < 0 ? 1 : 0)
      out.targetRir = clamp(rirCenter, priors.rirRange[0], priors.rirRange[1])
    }

    return out
  })
}

export function toCoachNarrative(exercises: AdaptiveExercise[], ctx: AdaptivePolicyContext): string {
  const nonCardio = exercises.filter(e => !e.isCardio)
  const cardio = exercises.filter(e => e.isCardio)
  const heavyCount = nonCardio.filter(e => e.exerciseRole === 'primary').length
  const hypertrophyCount = nonCardio.filter(e => e.targetReps >= 8).length
  const cardioMinutes = cardio.reduce((sum, c) => sum + Math.round((c.cardioDurationSeconds || 0) / 60), 0)
  return [
    `Coach plan: ${heavyCount} primary lifts and ${hypertrophyCount} hypertrophy-focused movements.`,
    cardioMinutes > 0 ? `Conditioning dose is ${cardioMinutes} min to support progression without compromising recovery.` : 'No dedicated conditioning block today.',
    `Policy confidence ${Math.round(ctx.policyConfidence * 100)}%; progression pressure ${ctx.personalState.progressionSignal >= 0 ? 'positive' : 'conservative'}.`,
  ].join(' ')
}
