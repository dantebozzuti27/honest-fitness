import pg from 'pg'
const { Pool } = pg

pg.types.setTypeParser(20, Number)    // INT8 (bigint)
pg.types.setTypeParser(1700, Number)  // NUMERIC / DECIMAL

let pool = null

export function getPool() {
  if (pool) return pool

  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error('DATABASE_URL is not set')
  }
  // Strip sslmode from the connection string — we configure SSL explicitly below.
  const connectionString = raw.replace(/[?&]sslmode=[^&]*/g, '')

  pool = new Pool({
    connectionString,
    // AWS RDS uses Amazon-issued certificates. rejectUnauthorized: true is ideal
    // but requires bundling the RDS CA cert. For managed RDS in a VPC with
    // IAM-auth, the risk of MITM is minimal; use false only for RDS.
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  pool.on('error', (err) => {
    console.error('[pg] Unexpected pool error:', err.message)
  })

  return pool
}

export async function query(text, params) {
  const p = getPool()
  const start = Date.now()
  try {
    const result = await p.query(text, params)
    const duration = Date.now() - start
    if (duration > 2000) {
      console.warn(`[pg] Slow query (${duration}ms):`, text.substring(0, 120))
    }
    return result
  } catch (err) {
    console.error('[pg] Query error:', err.message, '\nSQL:', text.substring(0, 200))
    throw err
  }
}

export async function getClient() {
  const p = getPool()
  return p.connect()
}

// Eagerly establish one TCP+TLS connection during module initialization so the
// first real query doesn't pay the ~2-5 s cold-connect penalty.
if (process.env.DATABASE_URL) {
  getPool().query('SELECT 1').catch(err => {
    console.warn('[pg] Pre-warm connection failed:', err.message)
  })
}
