-- VOLT — Username / Profile System
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run

-- Profiles table (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  direct_send_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive unique index on username
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
  ON public.profiles (lower(username));

-- Index for searching
CREATE INDEX IF NOT EXISTS profiles_username_search_idx
  ON public.profiles USING gin (username gin_trgm_ops);

-- If the trigram extension isn't enabled, run this first:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Everyone can read profiles (needed for username search)
CREATE POLICY "anyone can view profiles" ON public.profiles
  FOR SELECT USING (true);

-- Users can only update their own profile
CREATE POLICY "users update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Users can insert their own profile (during onboarding)
CREATE POLICY "users insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Reserved usernames (system terms)
-- You can expand this list as needed
CREATE TABLE IF NOT EXISTS public.reserved_usernames (
  username text PRIMARY KEY
);

INSERT INTO public.reserved_usernames (username) VALUES
  ('admin'), ('volt'), ('system'), ('support'), ('help'),
  ('api'), ('www'), ('app'), ('mail'), ('info'),
  ('null'), ('undefined'), ('anonymous'), ('root'), ('user')
ON CONFLICT DO NOTHING;
