-- QR Sessions table for scan-to-login
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run

CREATE TABLE IF NOT EXISTS public.qr_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_active timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qr_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own qr sessions" ON public.qr_sessions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "anyone can read pending by token" ON public.qr_sessions
  FOR SELECT USING (status = 'pending' OR status = 'confirmed');

CREATE INDEX IF NOT EXISTS qr_sessions_token_idx ON public.qr_sessions (token);
CREATE INDEX IF NOT EXISTS qr_sessions_expires_idx ON public.qr_sessions (expires_at);
