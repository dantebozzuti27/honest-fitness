// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function saveFeedItemToSupabase(feedItem, userId, options = {}) {
  const m = await import('../supabaseDb')
  return m.saveFeedItemToSupabase(feedItem, userId, options)
}

export async function getFeedItemsFromSupabase(userId, limit = 50) {
  const m = await import('../supabaseDb')
  return m.getFeedItemsFromSupabase(userId, limit)
}

export async function getSocialFeedItems(userId, filter = 'all', limit = 20, cursor = null) {
  const m = await import('../supabaseDb')
  return m.getSocialFeedItems(userId, filter, limit, cursor)
}

export async function deleteFeedItemFromSupabase(feedItemId, userId) {
  const m = await import('../supabaseDb')
  return m.deleteFeedItemFromSupabase(feedItemId, userId)
}


