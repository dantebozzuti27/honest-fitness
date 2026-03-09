/**
 * Sport-specific training profiles.
 *
 * Each profile defines how a sport should subtly influence the workout engine:
 *   - Which exercises get a scoring boost (high sport-transfer)
 *   - Which muscle groups are prioritised
 *   - Which exercises to limit (can restrict sport-relevant mobility)
 *   - Prehab exercises to mix in for injury prevention
 *   - Season-based volume modifiers
 */

export type SportSeason = 'off_season' | 'pre_season' | 'in_season'

export interface SportExerciseBoost {
  /** Lowercased exercise name (must match exercise library) */
  exerciseName: string
  /** Scoring bonus applied in stepSelectExercises (+2 to +4 range for subtle influence) */
  boost: number
  /** Why this exercise helps the sport */
  reason: string
}

export interface SportMuscleGroupPriority {
  muscleGroup: string
  /** Multiplier on volume target (1.0 = no change, 1.15 = 15% more sets) */
  volumeMultiplier: number
  reason: string
}

export interface SportExerciseLimit {
  exerciseName: string
  /** Scoring penalty in exercise selection */
  penalty: number
  reason: string
}

export interface SportPrehabExercise {
  exerciseName: string
  sets: number
  reps: number
  restSec: number
  reason: string
}

export interface SportProfile {
  sport: string
  label: string
  description: string

  exerciseBoosts: SportExerciseBoost[]
  muscleGroupPriorities: SportMuscleGroupPriority[]
  exerciseLimits: SportExerciseLimit[]
  prehabExercises: SportPrehabExercise[]

  seasonModifiers: Record<SportSeason, {
    volumeMultiplier: number
    intensityMultiplier: number
    prehabFrequency: number // 0-1: probability of injecting a prehab exercise per session
    description: string
  }>
}

// ─── Golf ──────────────────────────────────────────────────────────────────────

const GOLF: SportProfile = {
  sport: 'golf',
  label: 'Golf',
  description: 'Rotational power, hip mobility, core stability, and shoulder health for a consistent, powerful swing.',

  exerciseBoosts: [
    // Rotational power — direct swing transfer
    { exerciseName: 'cable woodchop', boost: 4, reason: 'Rotational power — direct golf swing transfer' },
    { exerciseName: 'russian twist', boost: 3, reason: 'Rotational core endurance' },
    { exerciseName: 'landmine rotation', boost: 4, reason: 'Loaded rotation with hip drive' },
    { exerciseName: 'medicine ball slam', boost: 2, reason: 'Explosive power generation' },

    // Anti-rotation / core stability — swing consistency
    { exerciseName: 'pallof press', boost: 4, reason: 'Anti-rotation core stability — swing plane consistency' },
    { exerciseName: 'cable pallof press', boost: 4, reason: 'Anti-rotation core stability' },
    { exerciseName: 'dead bug', boost: 3, reason: 'Core stability and coordination' },
    { exerciseName: 'bird dog', boost: 3, reason: 'Spinal stability and balance' },
    { exerciseName: 'plank', boost: 2, reason: 'Anti-extension core strength' },
    { exerciseName: 'side plank', boost: 3, reason: 'Lateral core stability — prevents sway' },

    // Hip and glute — power source
    { exerciseName: 'single-leg romanian deadlift', boost: 3, reason: 'Hip stability and posterior chain — weight transfer' },
    { exerciseName: 'dumbbell single-leg romanian deadlift', boost: 3, reason: 'Hip stability and posterior chain' },
    { exerciseName: 'hip thrust', boost: 2, reason: 'Glute power — drives rotation from ground up' },
    { exerciseName: 'barbell hip thrust', boost: 2, reason: 'Glute power for ground-up rotation' },
    { exerciseName: 'lateral lunge', boost: 3, reason: 'Hip mobility and adductor strength — stance stability' },
    { exerciseName: 'dumbbell lateral lunge', boost: 3, reason: 'Hip mobility and lateral stability' },
    { exerciseName: 'goblet squat', boost: 2, reason: 'Hip mobility under load' },
    { exerciseName: 'bulgarian split squat', boost: 2, reason: 'Unilateral leg strength — address asymmetries' },

    // Grip and forearm — club control
    { exerciseName: 'farmer carry', boost: 3, reason: 'Grip strength and core bracing — club control' },
    { exerciseName: "farmer carry (conditioning)", boost: 3, reason: 'Grip endurance' },
    { exerciseName: 'wrist curl', boost: 2, reason: 'Forearm strength — wrist stability at impact' },
    { exerciseName: 'reverse wrist curl', boost: 2, reason: 'Forearm extensor balance — prevents golfer\'s elbow' },

    // Shoulder stability — consistent swing path
    { exerciseName: 'face pull', boost: 3, reason: 'Posterior shoulder health — external rotation' },
    { exerciseName: 'band pull apart', boost: 3, reason: 'Scapular stability' },
    { exerciseName: 'cable external rotation', boost: 3, reason: 'Rotator cuff health' },
    { exerciseName: 'prone y raise', boost: 2, reason: 'Lower trap activation — overhead shoulder health' },

    // Thoracic mobility — separation between upper and lower body
    { exerciseName: 'cat cow', boost: 2, reason: 'Spinal mobility' },
  ],

  muscleGroupPriorities: [
    { muscleGroup: 'core', volumeMultiplier: 1.20, reason: 'Rotational power and stability are the foundation of the golf swing' },
    { muscleGroup: 'glutes', volumeMultiplier: 1.15, reason: 'Hip drive generates swing speed from the ground up' },
    { muscleGroup: 'posterior_deltoid', volumeMultiplier: 1.10, reason: 'Shoulder stability and rotator cuff health protect the swing' },
    { muscleGroup: 'forearms', volumeMultiplier: 1.10, reason: 'Grip and wrist control at impact' },
    { muscleGroup: 'back_lats', volumeMultiplier: 1.05, reason: 'Lat engagement stabilises the downswing' },
  ],

  exerciseLimits: [
    { exerciseName: 'behind the neck press', penalty: -4, reason: 'High impingement risk — restricts thoracic rotation' },
    { exerciseName: 'upright row', penalty: -3, reason: 'Internal rotation under load — shoulder impingement risk' },
  ],

  prehabExercises: [
    { exerciseName: 'dead bug', sets: 2, reps: 8, restSec: 30, reason: 'Core stability — prevents early extension' },
    { exerciseName: 'pallof press', sets: 2, reps: 10, restSec: 30, reason: 'Anti-rotation — consistent swing plane' },
    { exerciseName: 'face pull', sets: 2, reps: 15, restSec: 30, reason: 'Shoulder health — external rotation balance' },
    { exerciseName: 'bird dog', sets: 2, reps: 8, restSec: 30, reason: 'Spinal stability — low back protection' },
    { exerciseName: 'band pull apart', sets: 2, reps: 15, restSec: 30, reason: 'Scapular control' },
  ],

  seasonModifiers: {
    off_season: {
      volumeMultiplier: 1.0,
      intensityMultiplier: 1.0,
      prehabFrequency: 0.5,
      description: 'Build phase — normal gym volume, moderate prehab',
    },
    pre_season: {
      volumeMultiplier: 0.95,
      intensityMultiplier: 1.0,
      prehabFrequency: 0.7,
      description: 'Ramp phase — slightly less volume, more prehab as rounds increase',
    },
    in_season: {
      volumeMultiplier: 0.85,
      intensityMultiplier: 0.95,
      prehabFrequency: 0.8,
      description: 'Maintain phase — reduce gym volume to stay fresh for the course, prioritise prehab',
    },
  },
}

// ─── Registry ──────────────────────────────────────────────────────────────────

const SPORT_PROFILES: Record<string, SportProfile> = {
  golf: GOLF,
}

export function getSportProfile(sport: string | null | undefined): SportProfile | null {
  if (!sport) return null
  return SPORT_PROFILES[sport.toLowerCase()] ?? null
}

export function getAvailableSports(): Array<{ value: string; label: string }> {
  return Object.values(SPORT_PROFILES).map(p => ({ value: p.sport, label: p.label }))
}
