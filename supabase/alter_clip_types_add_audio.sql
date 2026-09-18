-- VOLT — Add 'audio' to allowed clip & transfer types
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- Idempotent: drops the existing type check constraints (if present) and
-- re-adds them to allow text | link | image | file | audio.

alter table public.clips drop constraint if exists clips_type_check;
alter table public.clips add constraint clips_type_check
  check (type in ('text','link','image','file','audio'));

alter table public.direct_transfers drop constraint if exists direct_transfers_type_check;
alter table public.direct_transfers add constraint direct_transfers_type_check
  check (type in ('text','link','image','file','audio'));
