import { openDB } from 'idb'

const DB_NAME = 'honest-fitness'
const DB_VERSION = 1

export async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Exercises store
      if (!db.objectStoreNames.contains('exercises')) {
        const exerciseStore = db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true })
        exerciseStore.createIndex('category', 'category')
        exerciseStore.createIndex('bodyPart', 'bodyPart')
        exerciseStore.createIndex('name', 'name')
      }
      
      // Templates store
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' })
      }
      
      // Workouts store (completed workouts)
      if (!db.objectStoreNames.contains('workouts')) {
        const workoutStore = db.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true })
        workoutStore.createIndex('date', 'date')
      }
      
      // Daily metrics store
      if (!db.objectStoreNames.contains('metrics')) {
        const metricsStore = db.createObjectStore('metrics', { keyPath: 'date' })
      }
      
      // Scheduled workouts store
      if (!db.objectStoreNames.contains('scheduled')) {
        db.createObjectStore('scheduled', { keyPath: 'date' })
      }
    }
  })
}

// Exercise functions
export async function getAllExercises() {
  const db = await getDB()
  return db.getAll('exercises')
}

export async function addExercise(exercise) {
  const db = await getDB()
  return db.add('exercises', exercise)
}

export async function bulkAddExercises(exercises) {
  const db = await getDB()
  const tx = db.transaction('exercises', 'readwrite')
  await Promise.all([
    ...exercises.map(e => tx.store.add(e)),
    tx.done
  ])
}

export async function getExercisesByBodyPart(bodyPart) {
  const db = await getDB()
  return db.getAllFromIndex('exercises', 'bodyPart', bodyPart)
}

// Template functions
export async function getAllTemplates() {
  const db = await getDB()
  return db.getAll('templates')
}

export async function getTemplate(id) {
  const db = await getDB()
  return db.get('templates', id)
}

export async function saveTemplate(template) {
  const db = await getDB()
  return db.put('templates', template)
}

export async function deleteTemplate(id) {
  const db = await getDB()
  return db.delete('templates', id)
}

export async function bulkAddTemplates(templates) {
  const db = await getDB()
  const tx = db.transaction('templates', 'readwrite')
  await Promise.all([
    ...templates.map(t => tx.store.put(t)),
    tx.done
  ])
}

// Workout functions
export async function saveWorkout(workout) {
  const db = await getDB()
  return db.add('workouts', {
    ...workout,
    date: workout.date || new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString()
  })
}

export async function getWorkoutsByDate(date) {
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
  return [...new Set(workouts.map(w => w.date))]
}

// Metrics functions
export async function saveMetrics(date, metrics) {
  const db = await getDB()
  return db.put('metrics', { date, ...metrics })
}

export async function getMetrics(date) {
  const db = await getDB()
  return db.get('metrics', date)
}

// Scheduled workout functions
export async function scheduleWorkout(date, templateId) {
  const db = await getDB()
  return db.put('scheduled', { date, templateId })
}

export async function getScheduledWorkout(date) {
  const db = await getDB()
  return db.get('scheduled', date)
}

// Streak calculation
export async function calculateStreak() {
  const dates = await getWorkoutDates()
  if (dates.length === 0) return 0
  
  const sortedDates = dates.sort((a, b) => new Date(b) - new Date(a))
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  
  // Check if most recent workout is today or yesterday
  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) {
    return 0
  }
  
  let streak = 1
  for (let i = 1; i < sortedDates.length; i++) {
    const current = new Date(sortedDates[i - 1])
    const prev = new Date(sortedDates[i])
    const diffDays = (current - prev) / 86400000
    
    if (diffDays === 1) {
      streak++
    } else {
      break
    }
  }
  
  return streak
}

// Check if exercises are loaded
export async function hasExercises() {
  const db = await getDB()
  const count = await db.count('exercises')
  return count > 0
}

// Clear and reload all exercises
export async function clearExercises() {
  const db = await getDB()
  await db.clear('exercises')
}

// Clear and reload all templates
export async function clearTemplates() {
  const db = await getDB()
  await db.clear('templates')
}

