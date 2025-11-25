import { bulkAddExercises, bulkAddTemplates, hasExercises, clearExercises, clearTemplates } from '../db'
import { EXERCISES, TEMPLATES } from '../data/seedData'

export async function initializeData() {
  const hasData = await hasExercises()
  if (hasData) return
  
  await bulkAddExercises(EXERCISES)
  await bulkAddTemplates(TEMPLATES)
}

export async function reloadData() {
  await clearExercises()
  await clearTemplates()
  await bulkAddExercises(EXERCISES)
  await bulkAddTemplates(TEMPLATES)
}

