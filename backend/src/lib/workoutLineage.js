const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidV4(s) {
  return typeof s === 'string' && UUID_V4_RE.test(s)
}

/**
 * Resolve canonical generated_workout_id for a completed session.
 * Prefers client-provided UUID when it exists for the user; otherwise
 * falls back to the active weekly plan day's planned_workout.id.
 */
export async function resolveGeneratedWorkoutId(client, userId, candidateId, workoutDate) {
  if (!userId) return null

  if (isUuidV4(candidateId)) {
    const owned = await client.query(
      'SELECT id FROM generated_workouts WHERE id = $1 AND user_id = $2 LIMIT 1',
      [candidateId, userId],
    )
    if (owned.rows[0]?.id) return owned.rows[0].id
  }

  if (!workoutDate) return null

  const fromPlan = await client.query(
    `SELECT (d.planned_workout->>'id') AS gen_id
     FROM weekly_plan_days d
     JOIN weekly_plan_versions v ON v.id = d.weekly_plan_id
     WHERE v.user_id = $1
       AND v.status = 'active'
       AND d.plan_date = $2::date
       AND d.planned_workout IS NOT NULL
     ORDER BY v.created_at DESC
     LIMIT 1`,
    [userId, workoutDate],
  )
  const planGenId = fromPlan.rows[0]?.gen_id
  if (!isUuidV4(planGenId)) return null

  const planOwned = await client.query(
    'SELECT id FROM generated_workouts WHERE id = $1 AND user_id = $2 LIMIT 1',
    [planGenId, userId],
  )
  return planOwned.rows[0]?.id ?? null
}
