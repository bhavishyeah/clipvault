-- Add pin_order column for drag-and-drop reordering of pinned clips
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run

ALTER TABLE public.clips
ADD COLUMN IF NOT EXISTS pin_order integer NOT NULL DEFAULT 0;

-- Index for efficient ordering
CREATE INDEX IF NOT EXISTS clips_pin_order_idx
  ON public.clips (user_id, pin_order);
