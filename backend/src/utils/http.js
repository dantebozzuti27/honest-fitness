/**
 * HTTP response helpers
 * Standardizes success/error envelopes across the backend.
 */

export function sendSuccess(res, payload = {}, status = 200) {
  return res.status(status).json({
    success: true,
    ...payload
  })
}

export function sendError(
  res,
  {
    status = 500,
    message = 'Internal server error',
    code = undefined,
    details = undefined
  } = {}
) {
  const requestId = res?.locals?.requestId
  return res.status(status).json({
    success: false,
    error: {
      message,
      status,
      ...(requestId ? { request_id: requestId } : {}),
      ...(code ? { code } : {}),
      ...(details !== undefined ? { details } : {})
    }
  })
}

export function wrapAsync(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}


