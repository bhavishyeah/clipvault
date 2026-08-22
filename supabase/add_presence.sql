-- VOLT — Presence System
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run

CREATE TABLE IF NOT EXISTS public.presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'offline',
  device text NOT NULL DEFAULT 'web',
  last_seen timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.presence ENABLE ROW LEVEL SECURITY;

-- Everyone can see presence (needed for Direct Send recipient search)
CREATE POLICY "anyone can view presence" ON public.presence
  FOR SELECT USING (true);

-- Users can only manage their own presence
CREATE POLICY "users manage own presence" ON public.presence
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own presence" ON public.presence
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "users delete own presence" ON public.presence
  FOR DELETE USING (auth.uid() = user_id);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS presence_status_idx ON public.presence (status);

-- Enable realtime on presence table
ALTER PUBLICATION supabase_realtime ADD TABLE public.presence;
