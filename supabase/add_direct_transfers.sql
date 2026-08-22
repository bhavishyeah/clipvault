-- VOLT — Direct Send / Transfers
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run

CREATE TABLE IF NOT EXISTS public.direct_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('text', 'link', 'image')),
  content text,
  file_url text,
  file_name text,
  file_size integer,
  mime_type text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

ALTER TABLE public.direct_transfers ENABLE ROW LEVEL SECURITY;

-- Sender can see and manage their sent transfers
CREATE POLICY "sender can view own transfers" ON public.direct_transfers
  FOR SELECT USING (auth.uid() = sender_id);

CREATE POLICY "sender can insert transfers" ON public.direct_transfers
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "sender can delete own transfers" ON public.direct_transfers
  FOR DELETE USING (auth.uid() = sender_id);

-- Recipient can see transfers sent to them
CREATE POLICY "recipient can view incoming" ON public.direct_transfers
  FOR SELECT USING (auth.uid() = recipient_id);

-- Recipient can update status (mark as delivered)
CREATE POLICY "recipient can update status" ON public.direct_transfers
  FOR UPDATE USING (auth.uid() = recipient_id);

-- Indexes
CREATE INDEX IF NOT EXISTS transfers_recipient_idx
  ON public.direct_transfers (recipient_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS transfers_sender_idx
  ON public.direct_transfers (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS transfers_expires_idx
  ON public.direct_transfers (expires_at);

-- Enable realtime for instant delivery notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_transfers;
