// Lazy wrapper around IndexedDB helpers in `app/src/db/index.js`.
// This avoids pulling the entire DB module into route bundles while still allowing use across the app.

async function loadDb() {
  return await import('./index.js')
}

// Exercises
export async function getAllExercises() {
  const db = await loadDb()
  return db.getAllExercises()
}

export async function bulkAddExercises(exercises) {
  const db = await loadDb()
  return db.bulkAddExercises(exercises)
}

export async function hasExercises() {
  const db = await loadDb()
  return db.hasExercises()
}

// Templates
export async function getAllTemplates() {
  const db = await loadDb()
  return db.getAllTemplates()
}

export async function getTemplate(id) {
  const db = await loadDb()
  return db.getTemplate(id)
}

export async function saveTemplate(template) {
  const db = await loadDb()
  return db.saveTemplate(template)
}

export async function deleteTemplate(id) {
  const db = await loadDb()
  return db.deleteTemplate(id)
}

export async function bulkAddTemplates(templates) {
  const db = await loadDb()
  return db.bulkAddTemplates(templates)
}

// Workouts (local)
export async function saveWorkout(workout) {
  const db = await loadDb()
  return db.saveWorkout(workout)
}


