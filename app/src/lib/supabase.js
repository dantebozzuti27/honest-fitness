import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ybmdqagdmfqrbzngryxn.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlibWRxYWdkbWZxcmJ6bmdyeXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwOTUxNTEsImV4cCI6MjA3OTY3MTE1MX0.xzHGaDY_dsRsH_huIRErRr2D2pBYKfxL1DgM06DmgLQ'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

