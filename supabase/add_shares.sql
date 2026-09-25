-- VOLT — Public share links (volt-reach)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- A `shares` row turns a clip into a public URL (/s/<token>) that anyone can
-- open without a VOLT account. Public reads happen ONLY through the
-- service-role endpoint GET /api/share; the anon role gets no direct access to
-- this table. Owners can read and manage (create/revoke) only their own shares.
-- Deleting a clip cascades to its shares, so a deleted clip's links go dead.

create table if not exists public.shares (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  clip_id     uuid not null references public.clips(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  revoked_at  timestamptz,
  view_count  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists shares_clip_id_idx on public.shares (clip_id);
create index if not exists shares_owner_id_idx on public.shares (owner_id);
create unique index if not exists shares_token_idx on public.shares (token);

alter table public.shares enable row level security;

-- Owners manage only their own shares. The anon role gets NO direct access;
-- public reads go through the service-role endpoint (GET /api/share) only.
drop policy if exists "owners read own shares" on public.shares;
create policy "owners read own shares" on public.shares
  for select using (owner_id = auth.uid());

drop policy if exists "owners insert own shares" on public.shares;
create policy "owners insert own shares" on public.shares
  for insert with check (owner_id = auth.uid());

drop policy if exists "owners update own shares" on public.shares;
create policy "owners update own shares" on public.shares
  for update using (owner_id = auth.uid());
