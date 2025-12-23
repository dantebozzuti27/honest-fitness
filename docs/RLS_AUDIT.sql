-- Honest Fitness — RLS Audit Queries (run in Supabase SQL editor)
-- Purpose: quickly identify tables missing RLS or missing policies.
-- Safe: read-only queries.

-- 1) Public tables with RLS NOT enabled (high risk)
select
  n.nspname as schema,
  c.relname as table,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname = 'public'
  and c.relrowsecurity = false
order by 1, 2;

-- 2) RLS-enabled public tables with ZERO policies (usually broken UX)
select
  schemaname as schema,
  tablename as table,
  count(*) as policy_count
from pg_policies
where schemaname = 'public'
group by 1, 2
having count(*) = 0
order by 1, 2;

-- 3) Tables present but missing expected INSERT/UPDATE/SELECT policies (spot checks)
-- Replace 'your_table' with a real table name.
-- select * from pg_policies where schemaname='public' and tablename='your_table' order by policyname;


