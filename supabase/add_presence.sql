-- VOLT — Presence System
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run

CREATE TABLE IF NOT EXISTS public.presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'offline',
  device text NOT NULL DEFAULT 'web',
  last_seen timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.presence ENABLE ROW LEVEL SECURITY;

-- Presence visibility is scoped: a user may read their OWN presence, and the
-- presence of anyone they have saved as a contact. The previous policy exposed
-- every user's online status / device / last-seen to every authenticated
-- account (a privacy leak). Direct Send recipient search still works: a search
-- result for someone who is not (yet) a contact simply shows no live status and
-- the client falls back to "offline" until the user adds them as a contact.
--
-- Idempotent: drop the old broad policy and any prior version of this one so
-- the migration can be re-run safely.
DROP POLICY IF EXISTS "anyone can view presence" ON public.presence;
DROP POLICY IF EXISTS "view own and contacts presence" ON public.presence;
CREATE POLICY "view own and contacts presence" ON public.presence
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.user_id = auth.uid()
        AND c.contact_id = public.presence.user_id
    )
  );

-- Users can only manage their own presence
DROP POLICY IF EXISTS "users manage own presence" ON public.presence;
CREATE POLICY "users manage own presence" ON public.presence
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users update own presence" ON public.presence;
CREATE POLICY "users update own presence" ON public.presence
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users delete own presence" ON public.presence;
CREATE POLICY "users delete own presence" ON public.presence
  FOR DELETE USING (auth.uid() = user_id);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS presence_status_idx ON public.presence (status);

-- Enable realtime on presence table (guarded so re-running is safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.presence;
  END IF;
END $$;
