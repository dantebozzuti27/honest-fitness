/**
 * User-scoped data integrity summary (read-only).
 */
import express from 'express'
import { query } from '../database/pg.js'

export const integrityRouter = express.Router()

integrityRouter.get('/summary', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) {
      return res.status(401).json({ ok: false, error: { message: 'Not authenticated' } })
    }

    const [dupes, orphaned, incompleteCompleted, missingLineage] = await Promise.all([
      query(
        `SELECT week_start_date, COUNT(*)::int AS active_count
         FROM weekly_plan_versions
         WHERE user_id = $1 AND status = 'active'
         GROUP BY week_start_date
         HAVING COUNT(*) > 1`,
        [userId],
      ),
      query(
        `SELECT COUNT(*)::int AS n
         FROM weekly_plan_days d
         LEFT JOIN weekly_plan_versions v ON v.id = d.weekly_plan_id
         WHERE d.user_id = $1 AND v.id IS NULL`,
        [userId],
      ),
      query(
        `SELECT COUNT(*)::int AS n
         FROM weekly_plan_days d
         JOIN weekly_plan_versions v ON v.id = d.weekly_plan_id
         WHERE v.user_id = $1 AND v.status = 'active'
           AND d.day_status = 'completed'
           AND d.actual_workout_id IS NULL`,
        [userId],
      ),
      query(
        `SELECT COUNT(*)::int AS n
         FROM workouts
         WHERE user_id = $1
           AND completed = true
           AND generated_workout_id IS NULL
           AND date >= (CURRENT_DATE - INTERVAL '30 days')`,
        [userId],
      ),
    ])

    const orphanedPlanDays = Number(orphaned.rows[0]?.n || 0)
    const completedDaysMissingWorkoutId = Number(incompleteCompleted.rows[0]?.n || 0)
    const recentWorkoutsMissingGeneratedId = Number(missingLineage.rows[0]?.n || 0)

    const ok =
      dupes.rows.length === 0 &&
      orphanedPlanDays === 0 &&
      completedDaysMissingWorkoutId === 0

    return res.json({
      ok,
      duplicateActiveWeeks: dupes.rows,
      orphanedPlanDays,
      completedDaysMissingWorkoutId,
      recentWorkoutsMissingGeneratedId,
    })
  } catch (err) {
    console.error('[integrity] summary error:', err.message)
    return res.status(500).json({ ok: false, error: { message: err.message } })
  }
})
