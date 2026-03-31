import pg from 'pg'

const { Pool } = pg

pg.types.setTypeParser(20, Number)    // INT8 (bigint)
pg.types.setTypeParser(1700, Number)  // NUMERIC / DECIMAL

let pool = null

export function getPool() {
  if (pool) return pool
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is not set')
  const connectionString = raw.replace(/[?&]sslmode=[^&]*/g, '')
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
  pool.on('error', (err) => console.error('[pg] Pool error:', err.message))
  return pool
}

export async function query(text, params) {
  return getPool().query(text, params)
}
