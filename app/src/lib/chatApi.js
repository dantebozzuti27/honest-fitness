import { supabase } from './supabase'

/**
 * Authenticated chat proxy to `/api/chat`
 * - Requires user session (Bearer token)
 * - Centralizes fetch + error handling
 */
export async function chatWithAI({ messages, context }) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.access_token) throw new Error('Authentication required')

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ messages, context })
  })

  let data = null
  try {
    data = await response.json()
  } catch (_) {
    // ignore
  }

  if (!response.ok) {
    const msg = data?.message || `Chat request failed (${response.status})`
    const err = new Error(msg)
    err.status = response.status
    err.details = data
    throw err
  }

  return data
}


