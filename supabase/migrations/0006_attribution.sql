-- Purchase attribution — where an order actually came from.
--
-- Captured in middleware on the first page a visitor lands on, carried in a
-- cookie, and written onto the order row when the lead is created. Two
-- questions, two answers:
--
--   first_source  who INTRODUCED this customer (first touch, 90-day cookie,
--                 never overwritten) — the number an influencer is paid on
--   source        what CLOSED the sale (last touch) — the number you judge a
--                 campaign on
--
-- Honest limitation: Instagram and Facebook in-app browsers strip the referrer
-- and WhatsApp sends none, so untagged traffic from those apps is
-- indistinguishable from someone typing the URL. It lands in 'direct'. The
-- fix is discipline, not code — use the tagged links from the admin link
-- builder everywhere.

-- Normalised channel. Free text rather than an enum: adding a channel should
-- not need a migration, and lib/attribution.ts is the real vocabulary.
--
-- Defaults to 'direct' and backfills existing rows, so the column is never
-- NULL. That's both honest — an order with no signal genuinely is direct — and
-- practical: the admin filter stays a plain equality check instead of every
-- query having to carry an "or is null" clause.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS first_source TEXT;

UPDATE orders SET source = 'direct' WHERE source IS NULL;
UPDATE orders SET first_source = 'direct' WHERE first_source IS NULL;

ALTER TABLE orders ALTER COLUMN source SET DEFAULT 'direct';
ALTER TABLE orders ALTER COLUMN first_source SET DEFAULT 'direct';

-- Raw campaign tags, for detail below the channel level ("which reel").
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_content TEXT;

-- Kept for debugging odd traffic — normalisation can only improve if you can
-- see what it failed to classify.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS referrer_url TEXT;

-- First page of the visit. Tells you whether an ad is pointing at the right
-- place, which is usually the cheapest conversion fix available.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS landing_path TEXT;

-- Everything on the insights page is "channel, over a date range".
CREATE INDEX IF NOT EXISTS idx_orders_source_created
  ON orders (source, created_at DESC);

-- Paid orders per channel — the revenue half of the same page.
CREATE INDEX IF NOT EXISTS idx_orders_source_paid
  ON orders (source, created_at DESC)
  WHERE payment_status = 'paid';
