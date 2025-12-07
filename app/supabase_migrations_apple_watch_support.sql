-- ============================================================================
-- MIGRATION: Apple Watch Support
-- Purpose: Ensure Apple Watch is supported in connected_accounts
-- ============================================================================

-- Optional: Add CHECK constraint to restrict providers to only the three supported
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'connected_accounts_provider_check'
  ) THEN
    ALTER TABLE connected_accounts 
    ADD CONSTRAINT connected_accounts_provider_check 
    CHECK (provider IN ('fitbit', 'oura', 'apple'));
  END IF;
END $$;

-- Note: Apple Watch data will be inserted into health_metrics with source_provider = 'apple_watch'
-- The normalization logic should be handled in your application code to map Apple Health data
-- to the standardized health_metrics columns

