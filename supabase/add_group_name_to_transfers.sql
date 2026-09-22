-- VOLT — tag direct transfers that came from a group send
alter table public.direct_transfers add column if not exists group_name text;
