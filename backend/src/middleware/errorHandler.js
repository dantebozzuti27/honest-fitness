/**
 * Error Handling Middleware
 */

import { sendError } from '../utils/http.js'

export function errorHandler(err, req, res, next) {
  const requestId = res?.locals?.requestId || req?.requestId
  console.error('Error:', {
    request_id: requestId,
    path: req?.originalUrl || req?.url,
    method: req?.method,
    message: err?.message,
    code: err?.code
  })
  
  const status = err.status || err.statusCode || 500
  const message = err.publicMessage || err.message || 'Internal server error'
  const code = err.code || err.error?.code

  return sendError(res, {
    status,
    message,
    code,
    details: process.env.NODE_ENV === 'development' ? { stack: err.stack } : undefined
  })
}

