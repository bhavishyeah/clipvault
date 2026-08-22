-- VOLT — Contacts (saved recipients for Direct Send)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, contact_id)
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own contacts" ON public.contacts
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS contacts_user_idx ON public.contacts (user_id);
