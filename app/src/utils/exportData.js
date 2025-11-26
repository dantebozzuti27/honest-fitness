import * as XLSX from 'xlsx'
import { getWorkoutsFromSupabase, getAllMetricsFromSupabase } from '../lib/supabaseDb'

export async function exportWorkoutData(userId, userEmail) {
  // Fetch all data
  const [workouts, metrics] = await Promise.all([
    getWorkoutsFromSupabase(userId),
    getAllMetricsFromSupabase(userId)
  ])

  const wb = XLSX.utils.book_new()

  // Workouts Summary Sheet
  const workoutSummary = workouts.map(w => ({
    Date: w.date,
    Duration: `${Math.floor(w.duration / 60)}:${String(w.duration % 60).padStart(2, '0')}`,
    Exercises: w.workout_exercises?.length || 0,
    'Total Sets': w.workout_exercises?.reduce((sum, ex) => sum + (ex.workout_sets?.length || 0), 0) || 0
  }))
  const summarySheet = XLSX.utils.json_to_sheet(workoutSummary)
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Workout Summary')

  // Detailed Exercises Sheet
  const exerciseDetails = []
  workouts.forEach(w => {
    w.workout_exercises?.forEach(ex => {
      ex.workout_sets?.forEach(set => {
        exerciseDetails.push({
          Date: w.date,
          Exercise: ex.exercise_name,
          Category: ex.category,
          'Body Part': ex.body_part,
          Set: set.set_number,
          Weight: set.weight || '',
          Reps: set.reps || '',
          Time: set.time || '',
          Speed: set.speed || '',
          Incline: set.incline || ''
        })
      })
    })
  })
  const exerciseSheet = XLSX.utils.json_to_sheet(exerciseDetails)
  XLSX.utils.book_append_sheet(wb, exerciseSheet, 'Exercise Details')

  // Daily Metrics Sheet
  const metricsData = metrics.map(m => ({
    Date: m.date,
    Weight: m.weight || '',
    'Sleep Score': m.sleep_score || '',
    'Sleep Time': m.sleep_time || '',
    HRV: m.hrv || '',
    Steps: m.steps || '',
    Calories: m.calories || ''
  }))
  const metricsSheet = XLSX.utils.json_to_sheet(metricsData)
  XLSX.utils.book_append_sheet(wb, metricsSheet, 'Daily Metrics')

  // Generate file
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  
  // Download file
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `HonestFitness_Export_${new Date().toISOString().split('T')[0]}.xlsx`
  a.click()
  URL.revokeObjectURL(url)

  // Open email with attachment instructions
  const subject = encodeURIComponent('My HonestFitness Workout Data')
  const body = encodeURIComponent(`Here's my workout data export from HonestFitness!\n\nTotal Workouts: ${workouts.length}\nDate Range: ${workouts.length > 0 ? `${workouts[workouts.length - 1]?.date} to ${workouts[0]?.date}` : 'N/A'}\n\nPlease attach the downloaded Excel file to this email.`)
  
  window.location.href = `mailto:${userEmail}?subject=${subject}&body=${body}`
  
  return { workouts: workouts.length, metrics: metrics.length }
}

