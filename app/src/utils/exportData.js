import { getWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { getAllMetricsFromSupabase } from '../lib/db/metricsDb'
import { getTodayEST } from './dateUtils'

/**
 * Convert array of objects to CSV string
 */
function arrayToCSV(data, headers) {
  if (!data || data.length === 0) {
    return headers.join(',') + '\n'
  }
  
  const rows = [headers.join(',')]
  
  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header] ?? ''
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return value
    })
    rows.push(values.join(','))
  })
  
  return rows.join('\n')
}

/**
 * Download CSV file
 */
function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportWorkoutData(userId, userEmail) {
  // Fetch all data
  const [workouts, metrics] = await Promise.all([
    getWorkoutsFromSupabase(userId),
    getAllMetricsFromSupabase(userId)
  ])

  const dateStr = getTodayEST()
  const baseFilename = `HonestFitness_Export_${dateStr}`

  // Workouts Summary CSV
  const workoutSummary = workouts.map(w => ({
    Date: w.date,
    Duration: `${Math.floor(w.duration / 60)}:${String(w.duration % 60).padStart(2, '0')}`,
    Exercises: w.workout_exercises?.length || 0,
    'Total Sets': w.workout_exercises?.reduce((sum, ex) => sum + (ex.workout_sets?.length || 0), 0) || 0
  }))
  const summaryCSV = arrayToCSV(workoutSummary, ['Date', 'Duration', 'Exercises', 'Total Sets'])
  downloadCSV(summaryCSV, `${baseFilename}_WorkoutSummary.csv`)

  // Wait a bit before next download to avoid browser blocking
  await new Promise(resolve => setTimeout(resolve, 300))

  // Detailed Exercises CSV
  const exerciseDetails = []
  workouts.forEach(w => {
    w.workout_exercises?.forEach(ex => {
      ex.workout_sets?.forEach(set => {
        exerciseDetails.push({
          Date: w.date,
          Exercise: ex.exercise_name || '',
          Category: ex.category || '',
          'Body Part': ex.body_part || '',
          Set: set.set_number || '',
          Weight: set.weight || '',
          Reps: set.reps || '',
          Time: set.time || '',
          Speed: set.speed || '',
          Incline: set.incline || ''
        })
      })
    })
  })
  const exerciseCSV = arrayToCSV(exerciseDetails, ['Date', 'Exercise', 'Category', 'Body Part', 'Set', 'Weight', 'Reps', 'Time', 'Speed', 'Incline'])
  downloadCSV(exerciseCSV, `${baseFilename}_ExerciseDetails.csv`)

  // Wait a bit before next download
  await new Promise(resolve => setTimeout(resolve, 300))

  // Daily Metrics CSV
  const metricsData = metrics.map(m => ({
    Date: m.date,
    Weight: m.weight || '',
    'Sleep Score': m.sleep_score || '',
    'Sleep Time': m.sleep_time || '',
    HRV: m.hrv || '',
    Steps: m.steps || '',
    Calories: m.calories || ''
  }))
  const metricsCSV = arrayToCSV(metricsData, ['Date', 'Weight', 'Sleep Score', 'Sleep Time', 'HRV', 'Steps', 'Calories'])
  downloadCSV(metricsCSV, `${baseFilename}_DailyMetrics.csv`)

  // Open email with attachment instructions
  const subject = encodeURIComponent('My HonestFitness Workout Data')
  const body = encodeURIComponent(`Here's my workout data export from HonestFitness!\n\nTotal Workouts: ${workouts.length}\nDate Range: ${workouts.length > 0 ? `${workouts[workouts.length - 1]?.date} to ${workouts[0]?.date}` : 'N/A'}\n\nThree CSV files have been downloaded:\n- Workout Summary\n- Exercise Details\n- Daily Metrics\n\nThese files can be opened in Excel. Please attach them to this email.`)
  
  window.location.href = `mailto:${userEmail}?subject=${subject}&body=${body}`
  
  return { workouts: workouts.length, metrics: metrics.length }
}

