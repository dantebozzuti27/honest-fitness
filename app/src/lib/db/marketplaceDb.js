import { requireSupabase } from '../supabase'

function normalizeProgram(row) {
  if (!row) return null
  return {
    id: row.id,
    coachId: row.coach_id,
    title: row.title,
    description: row.description || '',
    status: row.status,
    priceCents: Number(row.price_cents || 0),
    currency: row.currency || 'usd',
    tags: Array.isArray(row.tags) ? row.tags : [],
    preview: row.preview || {},
    content: row.content || {},
    publishedAt: row.published_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }
}

function normalizeCoachProfile(row) {
  if (!row) return null
  return {
    userId: row.user_id,
    displayName: row.display_name || '',
    bio: row.bio || '',
    profilePicture: row.profile_picture || null,
    isVerified: Boolean(row.is_verified),
    stripeAccountId: row.stripe_account_id || null
  }
}

export async function getUserProfiles(userIds) {
  const supabase = requireSupabase()
  const ids = (Array.isArray(userIds) ? userIds : []).filter(Boolean)
  if (ids.length === 0) return {}
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, username, display_name, profile_picture')
    .in('user_id', ids)
  if (error) throw error
  const map = {}
  for (const row of Array.isArray(data) ? data : []) {
    map[row.user_id] = row
  }
  return map
}

export async function getCoachProfile(userId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('coach_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return normalizeCoachProfile(data)
}

export async function getCoachProfiles(userIds) {
  const supabase = requireSupabase()
  const ids = (Array.isArray(userIds) ? userIds : []).filter(Boolean)
  if (ids.length === 0) return {}

  const { data, error } = await supabase
    .from('coach_profiles')
    .select('*')
    .in('user_id', ids)

  if (error) throw error
  const map = {}
  for (const row of Array.isArray(data) ? data : []) {
    map[row.user_id] = normalizeCoachProfile(row)
  }
  return map
}

export async function upsertCoachProfile(userId, profile) {
  const supabase = requireSupabase()
  const payload = {
    user_id: userId,
    display_name: profile?.displayName ?? null,
    bio: profile?.bio ?? null,
    profile_picture: profile?.profilePicture ?? null
  }
  const { data, error } = await supabase
    .from('coach_profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single()
  if (error) throw error
  return normalizeCoachProfile(data)
}

export async function listPublishedPrograms({ query = '', limit = 50 } = {}) {
  const supabase = requireSupabase()

  let q = supabase
    .from('coach_programs')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit)

  const cleaned = String(query || '').trim()
  if (cleaned) {
    // Best-effort search without relying on schema cache relationships.
    q = q.ilike('title', `%${cleaned}%`)
  }

  const { data, error } = await q
  if (error) throw error
  return (Array.isArray(data) ? data : []).map(normalizeProgram)
}

export async function getProgramById(programId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('coach_programs')
    .select('*')
    .eq('id', programId)
    .maybeSingle()
  if (error) throw error
  return normalizeProgram(data)
}

export async function listMyPrograms(coachId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('coach_programs')
    .select('*')
    .eq('coach_id', coachId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (Array.isArray(data) ? data : []).map(normalizeProgram)
}

export async function createProgram(coachId, program) {
  const supabase = requireSupabase()
  const payload = {
    coach_id: coachId,
    title: String(program?.title || '').trim(),
    description: program?.description || null,
    status: program?.status || 'draft',
    price_cents: Number(program?.priceCents || 0),
    currency: String(program?.currency || 'usd').toLowerCase(),
    tags: Array.isArray(program?.tags) ? program.tags : [],
    preview: program?.preview || {},
    content: program?.content || {}
  }
  const { data, error } = await supabase
    .from('coach_programs')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw error
  return normalizeProgram(data)
}

export async function updateProgram(coachId, programId, patch) {
  const supabase = requireSupabase()
  const payload = {}

  if (patch?.title !== undefined) payload.title = String(patch.title || '').trim()
  if (patch?.description !== undefined) payload.description = patch.description || null
  if (patch?.status !== undefined) payload.status = patch.status
  if (patch?.priceCents !== undefined) payload.price_cents = Number(patch.priceCents || 0)
  if (patch?.currency !== undefined) payload.currency = String(patch.currency || 'usd').toLowerCase()
  if (patch?.tags !== undefined) payload.tags = Array.isArray(patch.tags) ? patch.tags : []
  if (patch?.preview !== undefined) payload.preview = patch.preview || {}
  if (patch?.content !== undefined) payload.content = patch.content || {}
  if (patch?.publishedAt !== undefined) payload.published_at = patch.publishedAt

  const { data, error } = await supabase
    .from('coach_programs')
    .update(payload)
    .eq('id', programId)
    .eq('coach_id', coachId)
    .select('*')
    .maybeSingle()
  if (error) throw error
  return normalizeProgram(data)
}

export async function publishProgram(coachId, programId) {
  return updateProgram(coachId, programId, { status: 'published', publishedAt: new Date().toISOString() })
}

export async function archiveProgram(coachId, programId) {
  return updateProgram(coachId, programId, { status: 'archived' })
}

export async function deleteProgram(coachId, programId) {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('coach_programs')
    .delete()
    .eq('id', programId)
    .eq('coach_id', coachId)
  if (error) throw error
  return { deleted: true }
}

export async function getMyPurchaseForProgram(buyerId, programId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('coach_program_purchases')
    .select('*')
    .eq('buyer_id', buyerId)
    .eq('program_id', programId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

export async function listMyProgramPurchases(buyerId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('coach_program_purchases')
    .select('*')
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function getProgramsByIds(programIds) {
  const supabase = requireSupabase()
  const ids = (Array.isArray(programIds) ? programIds : []).filter(Boolean)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('coach_programs')
    .select('*')
    .in('id', ids)
  if (error) throw error
  return (Array.isArray(data) ? data : []).map(normalizeProgram)
}

// MVP: only supports free checkout (priceCents === 0). Paid checkout requires Stripe verification.
export async function claimFreeProgram(buyerId, program) {
  const supabase = requireSupabase()
  const priceCents = Number(program?.priceCents || 0)
  if (priceCents > 0) {
    const err = new Error('Paid checkout is not enabled yet for marketplace programs.')
    err.code = 'PAYMENTS_NOT_ENABLED'
    throw err
  }

  const payload = {
    program_id: program.id,
    buyer_id: buyerId,
    status: 'paid',
    amount_cents: 0,
    currency: program.currency || 'usd',
    provider: 'manual',
    provider_payment_id: null
  }

  const { data, error } = await supabase
    .from('coach_program_purchases')
    .upsert(payload, { onConflict: 'program_id,buyer_id' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function upsertProgramEnrollment(userId, programId, { startDate, scheduledCount = 0, metadata = {} } = {}) {
  const supabase = requireSupabase()
  const payload = {
    program_id: programId,
    user_id: userId,
    start_date: startDate,
    status: 'enrolled',
    scheduled_count: Number(scheduledCount || 0),
    metadata: metadata && typeof metadata === 'object' ? metadata : {}
  }
  const { data, error } = await supabase
    .from('coach_program_enrollments')
    .upsert(payload, { onConflict: 'program_id,user_id' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function getMyProgramEnrollment(userId, programId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('coach_program_enrollments')
    .select('*')
    .eq('program_id', programId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

export async function listMyProgramEnrollments(userId, programIds) {
  const supabase = requireSupabase()
  const ids = (Array.isArray(programIds) ? programIds : []).filter(Boolean)
  if (!userId || ids.length === 0) return []
  const { data, error } = await supabase
    .from('coach_program_enrollments')
    .select('*')
    .eq('user_id', userId)
    .in('program_id', ids)
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function deleteProgramEnrollment(userId, programId) {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('coach_program_enrollments')
    .delete()
    .eq('program_id', programId)
    .eq('user_id', userId)
  if (error) throw error
  return { deleted: true }
}

export async function listProgramEnrollmentsForCoach(programId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('coach_program_enrollments')
    .select('*')
    .eq('program_id', programId)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return Array.isArray(data) ? data : []
}


