import { bulkAddExercises, bulkAddTemplates, hasExercises, clearExercises, clearTemplates } from '../db'
import { EXERCISES, TEMPLATES } from '../data/seedData'

// IMPORTANT: This function ONLY seeds reference data (exercises and templates).
// It NEVER creates actual workout logs, meal logs, or health metric logs.
// All user logs are ONLY created through explicit user actions.
export async function initializeData() {
  const hasData = await hasExercises()
  if (hasData) return
  
  // Only seed reference data - exercises and templates for selection
  // This does NOT create any workout/meal/health logs
  await bulkAddExercises(EXERCISES)
  await bulkAddTemplates(TEMPLATES)
}

// IMPORTANT: This function ONLY reloads reference data.
// It NEVER creates actual workout logs, meal logs, or health metric logs.
export async function reloadData() {
  await clearExercises()
  await clearTemplates()
  // Only seed reference data - exercises and templates for selection
  // This does NOT create any workout/meal/health logs
  await bulkAddExercises(EXERCISES)
  await bulkAddTemplates(TEMPLATES)
}

