-- VOLT — Groups (group sharing)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run

create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 1 and 100),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)             -- prevents duplicate membership (Req 12.3)
);

create table if not exists public.group_messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  sender_id  uuid not null references auth.users(id) on delete cascade,
  type       text not null check (type in ('text','link','image','file','audio')),
  content    text,
  file_url   text,
  file_name  text,
  file_size  integer,
  mime_type  text,
  created_at timestamptz not null default now()
);

create index if not exists group_members_user_idx on public.group_members (user_id);
create index if not exists group_messages_group_idx on public.group_messages (group_id, created_at desc);

-- SECURITY DEFINER helper to avoid RLS recursion when reading group_members
create or replace function public.is_group_member(gid uuid, uid uuid)
returns boolean
language sql
security definer          -- runs as owner -> not subject to group_members RLS -> no recursion
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = uid
  );
$$;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;

-- groups: members can see their groups; owner can delete (Req 11.5/11.6); creator can insert
create policy "members read groups" on public.groups
  for select using (public.is_group_member(id, auth.uid()));
create policy "creator inserts group" on public.groups
  for insert with check (auth.uid() = owner_id);
create policy "owner deletes group" on public.groups
  for delete using (auth.uid() = owner_id);

-- group_members: members read (Req 15.3/15.4); owner inserts/deletes (Req 15.5); self-leave
create policy "members read membership" on public.group_members
  for select using (public.is_group_member(group_id, auth.uid()));
create policy "owner adds members" on public.group_members
  for insert with check (
    exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
  );
create policy "owner removes or member leaves" on public.group_members
  for delete using (
    exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
    or auth.uid() = user_id            -- self-leave (Req 12.5); owner-leave blocked in app (Req 12.6)
  );

-- group_messages: members read (Req 15.1/15.2) and insert (Req 14.1/14.4/15.6)
create policy "members read messages" on public.group_messages
  for select using (public.is_group_member(group_id, auth.uid()));
create policy "members send messages" on public.group_messages
  for insert with check (
    public.is_group_member(group_id, auth.uid()) and auth.uid() = sender_id
  );

alter publication supabase_realtime add table public.group_messages;
