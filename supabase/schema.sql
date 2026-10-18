-- VOLT — Supabase schema
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run

create table if not exists public.clips (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  type          text not null check (type in ('text', 'link', 'image', 'file', 'audio')),
  content       text,
  file_path     text,
  metadata      jsonb not null default '{}'::jsonb,
  source_device text not null default 'web',
  is_pinned     boolean not null default false,
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists clips_user_created_idx
  on public.clips (user_id, created_at desc);

-- Row Level Security: every user sees only their own clips
alter table public.clips enable row level security;

drop policy if exists "select own clips" on public.clips;
create policy "select own clips" on public.clips
  for select using (auth.uid() = user_id);

drop policy if exists "insert own clips" on public.clips;
create policy "insert own clips" on public.clips
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own clips" on public.clips;
create policy "update own clips" on public.clips
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own clips" on public.clips;
create policy "delete own clips" on public.clips
  for delete using (auth.uid() = user_id);

-- Private storage bucket for images / files
insert into storage.buckets (id, name, public)
values ('clips', 'clips', false)
on conflict (id) do nothing;

-- Storage RLS: files live under <user_id>/<filename>, owners only
drop policy if exists "read own files" on storage.objects;
create policy "read own files" on storage.objects
  for select using (
    bucket_id = 'clips' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "upload own files" on storage.objects;
create policy "upload own files" on storage.objects
  for insert with check (
    bucket_id = 'clips' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "delete own files" on storage.objects;
create policy "delete own files" on storage.objects
  for delete using (
    bucket_id = 'clips' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Realtime: phone saves appear instantly on the laptop
-- (safe to ignore the error if this line says the table is already added)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clips'
  ) then
    alter publication supabase_realtime add table public.clips;
  end if;
end $$;
