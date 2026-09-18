-- VOLT — Recovery Codes (2FA backup codes)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- Writes (insert/update/delete) are performed exclusively by the
-- service-role recovery-codes endpoint (api/recovery-codes.js).
-- Clients may only SELECT their own rows (never the plaintext codes,
-- which are never stored — only salted hashes).

create table if not exists public.recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists recovery_codes_user_idx
  on public.recovery_codes (user_id);

-- Enable RLS
alter table public.recovery_codes enable row level security;

-- Users can read their own recovery codes. No client insert/update/delete
-- policies are granted; all writes go through the service-role endpoint.
create policy "read own recovery codes" on public.recovery_codes
  for select using (auth.uid() = user_id);
