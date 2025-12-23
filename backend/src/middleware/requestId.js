import { randomUUID } from 'node:crypto'

/**
 * requestId middleware
 * - Generates a per-request id (or reuses incoming X-Request-Id)
 * - Attaches to req + res.locals
 * - Returns as X-Request-Id response header
 */
export function requestId(req, res, next) {
  const incoming = req.headers['x-request-id']
  const id = (typeof incoming === 'string' && incoming.trim()) ? incoming.trim() : randomUUID()
  req.requestId = id
  res.locals.requestId = id
  try {
    res.setHeader('X-Request-Id', id)
  } catch {
    // ignore
  }
  next()
}


