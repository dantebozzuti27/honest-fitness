import { openDB } from 'idb'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'

const DB_NAME = 'honest-fitness'
const DB_VERSION = 1

export async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('exercises')) {
        const exerciseStore = db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true })
        exerciseStore.createIndex('category', 'category')
        exerciseStore.createIndex('bodyPart', 'bodyPart')
        exerciseStore.createIndex('name', 'name')
      }
      
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' })
      }
      
      if (!db.objectStoreNames.contains('workouts')) {
        const workoutStore = db.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true })
        workoutStore.createIndex('date', 'date')
      }
      
      if (!db.objectStoreNames.contains('metrics')) {
        db.createObjectStore('metrics', { keyPath: 'date' })
      }
      
      if (!db.objectStoreNames.contains('scheduled')) {
        db.createObjectStore('scheduled', { keyPath: 'date' })
      }
    }
  })
}

export async function getAllExercises() {
  const db = await getDB()
  return db.getAll('exercises')
}

export async function addExercise(exercise: any) {
  const db = await getDB()
  return db.add('exercises', exercise)
}

export async function bulkAddExercises(exercises: any[]) {
  const db = await getDB()
  const tx = db.transaction('exercises', 'readwrite')
  await Promise.all([
    ...exercises.map((e: any) => tx.store.add(e)),
    tx.done
  ])
}

export async function getExercisesByBodyPart(bodyPart: string) {
  const db = await getDB()
  const normalized = (bodyPart || '').toLowerCase()
  const exact = await db.getAllFromIndex('exercises', 'bodyPart', bodyPart)
  if (exact.length > 0) return exact
  const all = await db.getAll('exercises')
  return all.filter((e: any) => (e.bodyPart || '').toLowerCase() === normalized)
}

export async function getAllTemplates() {
  const db = await getDB()
  return db.getAll('templates')
}

export async function getTemplate(id: string) {
  const db = await getDB()
  return db.get('templates', id)
}

export async function saveTemplate(template: any) {
  const db = await getDB()
  return db.put('templates', template)
}

export async function deleteTemplate(id: string) {
  const db = await getDB()
  return db.delete('templates', id)
}

export async function bulkAddTemplates(templates: any[]) {
  const db = await getDB()
  const tx = db.transaction('templates', 'readwrite')
  await Promise.all([
    ...templates.map((t: any) => tx.store.put(t)),
    tx.done
  ])
}

export async function saveWorkout(workout: any) {
  const db = await getDB()
  return db.add('workouts', {
    ...workout,
    supabase_id: workout.supabase_id || null,
    date: workout.date || getTodayEST(),
    timestamp: new Date().toISOString()
  })
}

export async function getWorkoutsByDate(date: string) {
  const db = await getDB()
  return db.getAllFromIndex('workouts', 'date', date)
}

export async function getAllWorkouts() {
  const db = await getDB()
  return db.getAll('workouts')
}

export async function getWorkoutDates() {
  const db = await getDB()
  const workouts = await db.getAll('workouts')
  return [...new Set(workouts.map((w: any) => w.date))]
}

export async function saveMetrics(date: string, metrics: any) {
  const db = await getDB()
  return db.put('metrics', { date, ...metrics })
}

export async function getMetrics(date: string) {
  const db = await getDB()
  return db.get('metrics', date)
}

export async function scheduleWorkout(date: string, templateId: string) {
  const db = await getDB()
  return db.put('scheduled', { date, templateId })
}

export async function getScheduledWorkout(date: string) {
  const db = await getDB()
  return db.get('scheduled', date)
}

export async function calculateStreak() {
  const dates = await getWorkoutDates()
  if (dates.length === 0) return 0
  
  const sortedDates = dates.sort((a: string, b: string) => new Date(b).getTime() - new Date(a).getTime())
  const today = getTodayEST()
  const yesterday = getYesterdayEST()
  
  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) {
    return 0
  }
  
  let streak = 1
  for (let i = 1; i < sortedDates.length; i++) {
    const current = new Date(sortedDates[i - 1])
    const prev = new Date(sortedDates[i])
    const diffDays = (current.getTime() - prev.getTime()) / 86400000
    
    if (diffDays === 1) {
      streak++
    } else {
      break
    }
  }
  
  return streak
}

export async function hasExercises() {
  const db = await getDB()
  const count = await db.count('exercises')
  return count > 0
}

export async function clearExercises() {
  const db = await getDB()
  await db.clear('exercises')
}

export async function clearTemplates() {
  const db = await getDB()
  await db.clear('templates')
}
