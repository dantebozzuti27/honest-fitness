// Pure utilities (no Supabase calls).
// Split out of `supabaseDb.js` to avoid pulling the whole DB module into route bundles.

// NOTE: This function ONLY generates a plan structure. It NEVER creates actual workout logs.
// Workouts are ONLY created when the user explicitly finishes a workout in ActiveWorkout.jsx
export function generateWorkoutPlan(prefs, templates) {
  const { fitnessGoal, experienceLevel, availableDays, sessionDuration } = prefs

  // Determine split based on days available
  const daysPerWeek = availableDays.length
  let split = []

  if (daysPerWeek <= 2) {
    split = ['Full Body', 'Full Body']
  } else if (daysPerWeek === 3) {
    if (fitnessGoal === 'strength' || fitnessGoal === 'hypertrophy') {
      split = ['Push', 'Pull', 'Legs']
    } else {
      split = ['Full Body', 'Cardio + Core', 'Full Body']
    }
  } else if (daysPerWeek === 4) {
    split = ['Upper', 'Lower', 'Upper', 'Lower']
  } else if (daysPerWeek === 5) {
    split = ['Push', 'Pull', 'Legs', 'Upper', 'Lower']
  } else {
    split = ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs']
  }

  // Map exercises based on focus
  const exercisesByFocus = {
    'Push': ['Bench Press', 'Overhead Press', 'Incline Dumbbell Press', 'Tricep Pushdowns', 'Lateral Raises', 'Chest Flyes'],
    'Pull': ['Deadlift', 'Barbell Rows', 'Pull-ups', 'Face Pulls', 'Bicep Curls', 'Lat Pulldowns'],
    'Legs': ['Squats', 'Romanian Deadlift', 'Leg Press', 'Leg Curls', 'Calf Raises', 'Lunges'],
    'Upper': ['Bench Press', 'Barbell Rows', 'Overhead Press', 'Pull-ups', 'Bicep Curls', 'Tricep Pushdowns'],
    'Lower': ['Squats', 'Romanian Deadlift', 'Leg Press', 'Leg Curls', 'Hip Thrusts', 'Calf Raises'],
    'Full Body': ['Squats', 'Bench Press', 'Barbell Rows', 'Overhead Press', 'Deadlift', 'Core Work'],
    'Cardio + Core': ['Treadmill Run', 'Planks', 'Russian Twists', 'Mountain Climbers', 'Bicycle Crunches']
  }

  // Adjust volume based on experience
  const setsPerExercise = experienceLevel === 'beginner' ? 3 : experienceLevel === 'intermediate' ? 4 : 5

  // Build schedule
  const schedule = availableDays.map((day, idx) => {
    const focus = split[idx % split.length]
    const exercises = exercisesByFocus[focus] || []

    // Adjust exercise count based on session duration
    const exerciseCount = Math.min(exercises.length, Math.floor(sessionDuration / 10))

    return {
      day,
      focus,
      exercises: exercises.slice(0, exerciseCount),
      sets: setsPerExercise,
      restDay: false
    }
  })

  // Add rest days
  const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  const fullSchedule = allDays.map(day => {
    const workoutDay = schedule.find(s => s.day === day)
    if (workoutDay) return workoutDay
    return { day, focus: 'Rest', restDay: true }
  })

  return {
    daysPerWeek,
    goal: fitnessGoal,
    experience: experienceLevel,
    schedule: fullSchedule
  }
}


