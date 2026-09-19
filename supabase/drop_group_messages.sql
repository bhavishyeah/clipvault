-- VOLT — remove the group chat message table (groups are now send-only distribution lists)
-- Remove from realtime publication first (ignore error if not present), then drop.
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='group_messages') then
    alter publication supabase_realtime drop table public.group_messages;
  end if;
end $$;
drop table if exists public.group_messages cascade;
