import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigOk = Boolean(supabaseUrl && supabaseAnonKey)
export const supabaseConfigErrorMessage = supabaseConfigOk
  ? ''
  : 'Missing required env vars: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (set them in your hosting provider / .env).'

// Never throw at import time; a missing config should render a user-visible error screen instead of a blank app.
export const supabase = supabaseConfigOk ? createClient(supabaseUrl, supabaseAnonKey) : null

// Central guard for any code path that requires Supabase.
// Prefer this over direct `supabase` usage so missing env never causes a TypeError.
export function requireSupabase() {
  if (!supabase) throw new Error(supabaseConfigErrorMessage)
  return supabase
}

