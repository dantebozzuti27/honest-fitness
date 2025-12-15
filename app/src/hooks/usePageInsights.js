import { useEffect, useMemo, useRef, useState } from 'react'
import { getPageInsights } from '../lib/backend'
import { logError } from '../utils/logger'

function cacheKey(page, context) {
  const day = new Date().toISOString().split('T')[0]
  const ctx = context && typeof context === 'object' ? context : {}
  return `page_insights:${page}:${day}:${JSON.stringify(ctx).slice(0, 500)}`
}

export function usePageInsights(page, context = {}, enabled = true) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  const key = useMemo(() => cacheKey(page, context), [page, context])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (!page) return

    // Cache-first (session)
    try {
      const cached = sessionStorage.getItem(key)
      if (cached) {
        const parsed = JSON.parse(cached)
        setData(parsed)
        return
      }
    } catch {
      // ignore
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const res = await getPageInsights(page, context)
        if (cancelled || !mountedRef.current) return
        setData(res)
        try {
          sessionStorage.setItem(key, JSON.stringify(res))
        } catch {
          // ignore
        }
      } catch (e) {
        if (cancelled || !mountedRef.current) return
        setError(e)
        logError('Failed to load page insights', e)
      } finally {
        if (cancelled || !mountedRef.current) return
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, page, key])

  return { loading, data, error }
}


