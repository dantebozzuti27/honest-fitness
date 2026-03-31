import express from 'express'
import { getClient } from '../database/pg.js'

export const rpcRouter = express.Router()

rpcRouter.post('/weekly-plan', async (req, res) => {
  const userId = req.userId
  if (!userId) {
    return res.status(401).json({ data: null, error: { message: 'Authentication required' } })
  }

  const { p_week_start_date, p_feature_snapshot_id, p_days, p_diffs } = req.body
  if (!p_week_start_date) {
    return res.status(400).json({ data: null, error: { message: 'Missing p_week_start_date' } })
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')

    const prevActive = await client.query(
      `SELECT id FROM weekly_plan_versions
       WHERE user_id = $1 AND week_start_date = $2 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [userId, p_week_start_date]
    )
    const prevActiveId = prevActive.rows.length > 0 ? prevActive.rows[0].id : null

    const newPlan = await client.query(
      `INSERT INTO weekly_plan_versions (user_id, week_start_date, status, feature_snapshot_id)
       VALUES ($1, $2, 'active', $3) RETURNING id`,
      [userId, p_week_start_date, p_feature_snapshot_id || null]
    )
    const newPlanId = newPlan.rows[0].id

    const days = Array.isArray(p_days) ? p_days : []
    for (const d of days) {
      await client.query(
        `INSERT INTO weekly_plan_days (
          weekly_plan_id, user_id, plan_date, day_of_week, is_rest_day,
          focus, muscle_groups, planned_workout, estimated_minutes, confidence,
          llm_verdict, llm_corrections, day_status, actual_workout_id,
          actual_workout, last_reconciled_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          newPlanId,
          userId,
          d.plan_date,
          d.day_of_week ?? 0,
          d.is_rest_day ?? false,
          d.focus || null,
          JSON.stringify(d.muscle_groups ?? []),
          d.planned_workout ? JSON.stringify(d.planned_workout) : null,
          d.estimated_minutes != null ? parseInt(d.estimated_minutes, 10) : null,
          d.confidence != null ? parseFloat(d.confidence) : 0.5,
          d.llm_verdict || null,
          d.llm_corrections ? JSON.stringify(d.llm_corrections) : null,
          d.day_status || 'planned',
          d.actual_workout_id || null,
          d.actual_workout ? JSON.stringify(d.actual_workout) : null,
          d.last_reconciled_at || null,
        ]
      )
    }

    const diffs = Array.isArray(p_diffs) ? p_diffs : []
    for (const x of diffs) {
      await client.query(
        `INSERT INTO weekly_plan_diffs (
          weekly_plan_id, user_id, plan_date, reason_codes,
          before_workout, after_workout, diff_summary
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          newPlanId,
          userId,
          x.plan_date,
          JSON.stringify(x.reason_codes ?? []),
          x.before_workout ? JSON.stringify(x.before_workout) : null,
          x.after_workout ? JSON.stringify(x.after_workout) : null,
          JSON.stringify(x.diff_summary ?? {}),
        ]
      )
    }

    if (prevActiveId) {
      await client.query(
        `UPDATE weekly_plan_versions SET status = 'superseded'
         WHERE id = $1 AND user_id = $2 AND status = 'active'`,
        [prevActiveId, userId]
      )
    }

    await client.query('COMMIT')
    return res.json({ data: newPlanId, error: null })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[rpc/weekly-plan] Error:', err.message)
    return res.status(500).json({ data: null, error: { message: err.message } })
  } finally {
    client.release()
  }
})
