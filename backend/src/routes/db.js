import express from 'express'
import { query, getClient } from '../database/pg.js'

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/

function normalizeDates(obj) {
  if (obj === null || obj === undefined) return obj
  if (obj instanceof Date) {
    const iso = obj.toISOString()
    return DATE_ONLY_RE.test(iso) ? iso.substring(0, 10) : iso
  }
  if (typeof obj === 'string' && DATE_ONLY_RE.test(obj)) return obj.substring(0, 10)
  if (Array.isArray(obj)) return obj.map(normalizeDates)
  if (typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) out[k] = normalizeDates(v)
    return out
  }
  return obj
}

export const dbRouter = express.Router()

dbRouter.use((_req, res, next) => {
  const origJson = res.json.bind(res)
  res.json = (body) => {
    if (body && body.data != null) body.data = normalizeDates(body.data)
    return origJson(body)
  }
  next()
})

const TABLE_ALLOWLIST = new Set([
  'health_metrics',
  'user_preferences',
  'workouts',
  'workout_exercises',
  'workout_sets',
  'exercise_library',
  'generated_workouts',
  'workout_outcomes',
  'prescription_execution_events',
  'exercise_swaps',
  'model_feedback',
  'weekly_plan_versions',
  'weekly_plan_days',
  'weekly_plan_diffs',
  'cardio_capability_profiles',
  'cardio_set_feedback',
  'set_transformation_audit',
  'nutrition_adherence_daily_snapshots',
  'decision_provenance_events',
  'intervention_episodes',
  'intervention_episode_outcomes',
  'replay_scenarios',
  'replay_results',
  'llm_validation_artifacts',
  'user_profiles',
  'friends',
  'feed_items',
  'food_categories',
  'food_library',
  'user_food_preferences',
  'paused_workouts',
  'scheduled_workouts',
  'active_workout_sessions',
  'connected_accounts',
  'fitbit_daily',
  'goals',
  'coach_profiles',
  'coach_programs',
  'coach_program_purchases',
  'coach_program_enrollments',
  'users',
])

const PUBLIC_TABLES = new Set([
  'exercise_library',
  'food_categories',
  'food_library',
])

const OWNERSHIP_COLUMN = {
  users: 'id',
  // workout_exercises and workout_sets are scoped through their parent FKs
  // (workout_id -> workouts.user_id). The proxy enforces ownership by validating
  // the parent workout belongs to the requesting user before allowing child writes.
  workout_exercises: null,
  workout_sets: null,
}

function getUserIdColumn(table) {
  if (table in OWNERSHIP_COLUMN) return OWNERSHIP_COLUMN[table]
  return 'user_id'
}

const FILTER_OPS = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  is: 'IS',
  like: 'LIKE',
  ilike: 'ILIKE',
}

// Strict identifier validation — only allow alphanumeric + underscore.
// Prevents SQL injection through column names, onConflict, order-by, etc.
const SAFE_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
function isSafeIdentifier(name) {
  return typeof name === 'string' && SAFE_IDENT_RE.test(name) && name.length <= 128
}

function buildWhereClause(filters, userId, table, params) {
  const clauses = []
  const isPublicTable = PUBLIC_TABLES.has(table)
  const ownerCol = getUserIdColumn(table)

  if (!isPublicTable && userId && ownerCol) {
    params.push(userId)
    clauses.push(`"${ownerCol}" = $${params.length}`)
  }

  if (Array.isArray(filters)) {
    for (const f of filters) {
      const { column, op, value } = f
      if (!column || !isSafeIdentifier(column)) continue

      if (op === 'in' && Array.isArray(value)) {
        const placeholders = value.map((v) => {
          params.push(v)
          return `$${params.length}`
        })
        clauses.push(`"${column}" IN (${placeholders.join(', ')})`)
      } else if (op === 'is' && value === null) {
        clauses.push(`"${column}" IS NULL`)
      } else if (op === 'is_not' && value === null) {
        clauses.push(`"${column}" IS NOT NULL`)
      } else if (FILTER_OPS[op]) {
        params.push(value)
        clauses.push(`"${column}" ${FILTER_OPS[op]} $${params.length}`)
      }
    }
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}

const FK_MAP = {
  workout_exercises: { parent: 'workouts', fk: 'workout_id', pk: 'id' },
  workout_sets: { parent: 'workout_exercises', fk: 'workout_exercise_id', pk: 'id' },
}

function parseColumnsAndRelations(columns) {
  if (!columns || columns === '*') return { cols: '*', relations: [] }
  if (typeof columns !== 'string') return { cols: '*', relations: [] }

  const relations = []
  let cleaned = columns

  const regex = /(\w+)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g
  let match
  while ((match = regex.exec(columns)) !== null) {
    const relTable = match[1]
    const relCols = match[2]
    relations.push({ table: relTable, columns: relCols, raw: match[0] })
    cleaned = cleaned.replace(match[0], '')
  }

  cleaned = cleaned
    .split(',')
    .map(c => c.trim())
    .filter(c => c && isSafeIdentifier(c))
    .join(', ')

  return { cols: cleaned || '*', relations }
}

async function resolveRelations(rows, relations, parentTable) {
  if (!relations.length || !rows.length) return

  for (const rel of relations) {
    const fkInfo = FK_MAP[rel.table]
    if (!fkInfo || fkInfo.parent !== parentTable) continue

    const parentIds = [...new Set(rows.map(r => r[fkInfo.pk]).filter(Boolean))]
    if (parentIds.length === 0) continue

    const subParsed = parseColumnsAndRelations(rel.columns)
    const extraCols = new Set([fkInfo.fk])
    if (subParsed.relations.length > 0) {
      for (const subRel of subParsed.relations) {
        const subFk = FK_MAP[subRel.table]
        if (subFk && subFk.parent === rel.table) extraCols.add(subFk.pk)
      }
    }
    const subCols = subParsed.cols === '*' ? '*' : [...extraCols, ...subParsed.cols.split(',').map(c => c.trim())].filter((v, i, a) => a.indexOf(v) === i).join(', ')

    const placeholders = parentIds.map((_, i) => `$${i + 1}`).join(', ')
    const subResult = await query(
      `SELECT ${subCols} FROM "${rel.table}" WHERE "${fkInfo.fk}" IN (${placeholders})`,
      parentIds
    )

    if (subParsed.relations.length > 0) {
      await resolveRelations(subResult.rows, subParsed.relations, rel.table)
    }

    const grouped = {}
    for (const row of subResult.rows) {
      const key = row[fkInfo.fk]
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(row)
    }

    for (const parentRow of rows) {
      parentRow[rel.table] = grouped[parentRow[fkInfo.pk]] || []
    }
  }
}

// For child tables without user_id, verify the parent row belongs to the requesting user.
const PARENT_OWNERSHIP = {
  workout_exercises: { parentTable: 'workouts', fkCol: 'workout_id', ownerCol: 'user_id' },
  workout_sets: { parentTable: 'workout_exercises', fkCol: 'workout_exercise_id', ownerCol: null,
    grandparent: { parentTable: 'workouts', fkCol: 'workout_id', ownerCol: 'user_id' } },
}

async function verifyParentOwnership(table, dataRows, userId) {
  const rule = PARENT_OWNERSHIP[table]
  if (!rule || !userId) return true

  const fkValues = [...new Set(dataRows.map(r => r[rule.fkCol]).filter(Boolean))]
  if (fkValues.length === 0) return true

  if (rule.ownerCol) {
    const placeholders = fkValues.map((_, i) => `$${i + 1}`).join(', ')
    const check = await query(
      `SELECT id FROM "${rule.parentTable}" WHERE id IN (${placeholders}) AND "${rule.ownerCol}" = $${fkValues.length + 1}`,
      [...fkValues, userId]
    )
    return check.rows.length === fkValues.length
  }

  if (rule.grandparent) {
    const gp = rule.grandparent
    const placeholders = fkValues.map((_, i) => `$${i + 1}`).join(', ')
    const check = await query(
      `SELECT we.id FROM "${rule.parentTable}" we JOIN "${gp.parentTable}" w ON we."${gp.fkCol}" = w.id WHERE we.id IN (${placeholders}) AND w."${gp.ownerCol}" = $${fkValues.length + 1}`,
      [...fkValues, userId]
    )
    return check.rows.length === fkValues.length
  }

  return true
}

function buildSelectColumns(columns) {
  const { cols } = parseColumnsAndRelations(columns)
  return cols
}

function buildOrderClause(order) {
  if (!Array.isArray(order) || order.length === 0) return ''
  const parts = order
    .filter((o) => o.column && isSafeIdentifier(o.column))
    .map((o) => `"${o.column}" ${o.ascending === false ? 'DESC' : 'ASC'}${o.nullsFirst ? ' NULLS FIRST' : ''}`)
  return parts.length > 0 ? `ORDER BY ${parts.join(', ')}` : ''
}

dbRouter.post('/', async (req, res) => {
  try {
    const userId = req.userId
    const { table, operation, filters, data, columns, order, limit, offset, onConflict, count: countMode, single, maybeSingle } = req.body

    if (!table || !TABLE_ALLOWLIST.has(table)) {
      return res.status(400).json({ data: null, error: { message: `Table '${table}' is not allowed` } })
    }

    if (!operation) {
      return res.status(400).json({ data: null, error: { message: 'Missing operation' } })
    }

    const isPublicTable = PUBLIC_TABLES.has(table)
    if (!isPublicTable && !userId) {
      return res.status(401).json({ data: null, error: { message: 'Authentication required' } })
    }

    const params = []
    let sql = ''
    let result

    switch (operation) {
      case 'select': {
        const parsed = parseColumnsAndRelations(columns)
        const cols = parsed.cols
        const where = buildWhereClause(filters, userId, table, params)
        const orderStr = buildOrderClause(order)
        const limitStr = limit ? `LIMIT ${parseInt(limit, 10)}` : ''
        const offsetStr = offset ? `OFFSET ${parseInt(offset, 10)}` : ''
        sql = `SELECT ${cols} FROM "${table}" ${where} ${orderStr} ${limitStr} ${offsetStr}`
        result = await query(sql, params)

        if (parsed.relations.length > 0) {
          await resolveRelations(result.rows, parsed.relations, table)
        }

        let resultData = result.rows
        if (single) {
          if (result.rows.length === 0) {
            return res.json({ data: null, error: { message: 'Row not found', code: 'PGRST116' } })
          }
          resultData = result.rows[0]
        } else if (maybeSingle) {
          resultData = result.rows.length > 0 ? result.rows[0] : null
        }
        return res.json({ data: resultData, error: null, count: countMode ? result.rowCount : undefined })
      }

      case 'insert': {
        const rows = Array.isArray(data) ? data : [data]
        if (rows.length === 0) {
          return res.json({ data: [], error: null })
        }

        const ownerCol = getUserIdColumn(table)
        const insertRows = rows.map((row) => {
          const r = { ...row }
          if (!isPublicTable && userId && ownerCol) r[ownerCol] = userId
          return r
        })

        if (PARENT_OWNERSHIP[table] && userId) {
          const ownerOk = await verifyParentOwnership(table, insertRows, userId)
          if (!ownerOk) {
            return res.status(403).json({ data: null, error: { message: 'Parent record does not belong to user' } })
          }
        }

        const allKeys = [...new Set(insertRows.flatMap(Object.keys))].filter(isSafeIdentifier)
        const colNames = allKeys.map((k) => `"${k}"`).join(', ')
        const valueGroups = insertRows.map((row) => {
          const vals = allKeys.map((k) => {
            const v = row[k]
            if (v !== undefined && v !== null && typeof v === 'object') {
              params.push(JSON.stringify(v))
            } else {
              params.push(v ?? null)
            }
            return `$${params.length}`
          })
          return `(${vals.join(', ')})`
        })

        sql = `INSERT INTO "${table}" (${colNames}) VALUES ${valueGroups.join(', ')}`

        if (onConflict) {
          const conflictCols = onConflict.split(',').map(s => s.trim()).filter(isSafeIdentifier)
          if (conflictCols.length === 0) {
            return res.status(400).json({ data: null, error: { message: 'Invalid onConflict columns' } })
          }
          const conflictStr = conflictCols.map(c => `"${c}"`).join(', ')
          sql += ` ON CONFLICT (${conflictStr}) DO UPDATE SET ${allKeys
            .filter((k) => !conflictCols.includes(k))
            .map((k) => `"${k}" = EXCLUDED."${k}"`)
            .join(', ')}`
        }

        sql += ' RETURNING *'
        result = await query(sql, params)

        let insertResult = result.rows
        if (single) insertResult = result.rows[0] || null
        else if (maybeSingle) insertResult = result.rows[0] || null
        return res.json({ data: insertResult, error: null })
      }

      case 'upsert': {
        const rows = Array.isArray(data) ? data : [data]
        if (rows.length === 0) return res.json({ data: [], error: null })

        const ownerColU = getUserIdColumn(table)
        const insertRows = rows.map((row) => {
          const r = { ...row }
          if (!isPublicTable && userId && ownerColU) r[ownerColU] = userId
          return r
        })

        const allKeys = [...new Set(insertRows.flatMap(Object.keys))].filter(isSafeIdentifier)
        const colNames = allKeys.map((k) => `"${k}"`).join(', ')
        const valueGroups = insertRows.map((row) => {
          const vals = allKeys.map((k) => {
            const v = row[k]
            if (v !== undefined && v !== null && typeof v === 'object') {
              params.push(JSON.stringify(v))
            } else {
              params.push(v ?? null)
            }
            return `$${params.length}`
          })
          return `(${vals.join(', ')})`
        })

        const conflictTarget = onConflict || 'id'
        const conflictCols = conflictTarget.split(',').map(s => s.trim()).filter(isSafeIdentifier)
        if (conflictCols.length === 0) {
          return res.status(400).json({ data: null, error: { message: 'Invalid onConflict columns' } })
        }
        const conflictStr = conflictCols.map(c => `"${c}"`).join(', ')
        const updateCols = allKeys.filter((k) => !conflictCols.includes(k))

        sql = `INSERT INTO "${table}" (${colNames}) VALUES ${valueGroups.join(', ')} ON CONFLICT (${conflictStr}) DO UPDATE SET ${updateCols.map((k) => `"${k}" = EXCLUDED."${k}"`).join(', ')} RETURNING *`
        result = await query(sql, params)

        let upsertResult = result.rows
        if (single) upsertResult = result.rows[0] || null
        else if (maybeSingle) upsertResult = result.rows[0] || null
        return res.json({ data: upsertResult, error: null })
      }

      case 'update': {
        if (!data || typeof data !== 'object') {
          return res.status(400).json({ data: null, error: { message: 'Missing update data' } })
        }

        const setClauses = Object.entries(data)
          .filter(([k]) => isSafeIdentifier(k))
          .map(([k, v]) => {
            if (v !== undefined && v !== null && typeof v === 'object') {
              params.push(JSON.stringify(v))
            } else {
              params.push(v ?? null)
            }
            return `"${k}" = $${params.length}`
          })

        const where = buildWhereClause(filters, userId, table, params)
        sql = `UPDATE "${table}" SET ${setClauses.join(', ')} ${where} RETURNING *`
        result = await query(sql, params)

        let updateResult = result.rows
        if (single) updateResult = result.rows[0] || null
        else if (maybeSingle) updateResult = result.rows[0] || null
        return res.json({ data: updateResult, error: null })
      }

      case 'delete': {
        const where = buildWhereClause(filters, userId, table, params)
        if (!where) {
          return res.status(400).json({ data: null, error: { message: 'DELETE without filters is not allowed' } })
        }
        sql = `DELETE FROM "${table}" ${where} RETURNING *`
        result = await query(sql, params)
        return res.json({ data: result.rows, error: null })
      }

      default:
        return res.status(400).json({ data: null, error: { message: `Unknown operation: ${operation}` } })
    }
  } catch (err) {
    console.error('[db-proxy] Error:', err.message, '| SQL:', sql, '| Params:', JSON.stringify(params), '| Table:', req.body?.table, '| Op:', req.body?.operation)
    return res.status(500).json({
      data: null,
      error: { message: err.message || 'Internal server error' },
    })
  }
})
