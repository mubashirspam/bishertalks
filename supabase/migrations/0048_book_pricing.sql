-- The book's price, in the place that governs paying for it — and a price
-- change that can be set in advance.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically. The code that
-- reads these columns falls back to the old `courses` row if they are missing,
-- so a deploy landing first degrades to today's behaviour rather than taking
-- the checkout down — but the schedule does nothing until this is applied.
--
-- WHY: `getProductPricing()` read `price` / `offer_price` off the `courses` row
-- for the NLP bonus course. The price of the product was a field on the free
-- gift that comes with it, edited under Courses → NLP, while the Checkout tab
-- that owns gift wrapping, the promo field and every promo code could not touch
-- it. 0042 said as much when it created this table: "'what does the checkout
-- show' is a different question that will get asked again."
--
-- AND: the pre-booking price has to become the full price at a particular
-- moment — tonight, when the launch window closes — without somebody being
-- awake to press a button.
--
-- HOW THE SCHEDULE FIRES, and it is the important part: **nothing fires.**
-- There is no scheduler in this deployment; vercel.json has no crons, and
-- docs/delhivery-runbook.md says the same about the courier poller. So the read
-- resolves which pair applies against the clock, on every request, and the
-- pages that show a price are force-dynamic anyway. That beats a job on every
-- axis that matters here: exact to the second, impossible to miss, impossible
-- to double-fire, and a time set in the past simply applies immediately.

ALTER TABLE checkout_settings
  -- What the customer sees struck through.
  ADD COLUMN IF NOT EXISTS book_price_rupees INT,
  -- What the customer is actually charged. NULL means there is no offer on and
  -- the price above is the price — the same shape `courses.offer_price` had,
  -- kept so `shapePricing` did not have to learn a new one.
  ADD COLUMN IF NOT EXISTS book_offer_rupees INT,

  -- The change waiting to happen. All three or none: a price with no moment is
  -- a price that never arrives, and a moment with no price would blank the
  -- checkout at midnight.
  ADD COLUMN IF NOT EXISTS next_book_price_rupees INT,
  ADD COLUMN IF NOT EXISTS next_book_offer_rupees INT,
  ADD COLUMN IF NOT EXISTS price_effective_at TIMESTAMPTZ;

COMMENT ON COLUMN checkout_settings.price_effective_at IS
  'When next_book_* replaces book_*. Resolved on read, not by any job. A time '
  'in the past applies immediately.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed from what is live, so applying this changes no price
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Read out of the row the code is being moved off, rather than typed in as 999
-- and 699. If somebody re-priced the book between this file being written and
-- being applied, the typed version would silently roll that back — on the one
-- number the business runs on.

UPDATE checkout_settings
SET book_price_rupees = COALESCE(book_price_rupees, c.price),
    book_offer_rupees = COALESCE(book_offer_rupees, c.offer_price),
    updated_at = NOW()
FROM courses c
WHERE checkout_settings.id = TRUE
  AND c.slug = 'nlp';

-- Last resort, if that course row has gone: the same env default the code has
-- always fallen back to. Better a known price than a NULL the checkout has to
-- interpret mid-purchase.
UPDATE checkout_settings
SET book_price_rupees = 999
WHERE id = TRUE AND book_price_rupees IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rules
-- ─────────────────────────────────────────────────────────────────────────────
--
-- An offer above its own compare-at is not a discount, it is a struck-through
-- number smaller than the one being charged — which reads as a mistake to every
-- customer who sees it. Cheap to prevent here, and the API validates too.

ALTER TABLE checkout_settings
  DROP CONSTRAINT IF EXISTS checkout_settings_price_sane,
  ADD CONSTRAINT checkout_settings_price_sane CHECK (
    book_price_rupees IS NULL OR book_price_rupees > 0
  ),

  DROP CONSTRAINT IF EXISTS checkout_settings_offer_sane,
  ADD CONSTRAINT checkout_settings_offer_sane CHECK (
    book_offer_rupees IS NULL
    OR (book_offer_rupees > 0 AND book_offer_rupees <= book_price_rupees)
  ),

  DROP CONSTRAINT IF EXISTS checkout_settings_next_offer_sane,
  ADD CONSTRAINT checkout_settings_next_offer_sane CHECK (
    next_book_offer_rupees IS NULL
    OR (next_book_offer_rupees > 0
        AND next_book_offer_rupees <= next_book_price_rupees)
  ),

  -- A scheduled change is all three columns or none of them.
  DROP CONSTRAINT IF EXISTS checkout_settings_schedule_whole,
  ADD CONSTRAINT checkout_settings_schedule_whole CHECK (
    (price_effective_at IS NULL AND next_book_price_rupees IS NULL)
    OR (price_effective_at IS NOT NULL AND next_book_price_rupees IS NOT NULL)
  );

NOTIFY pgrst, 'reload schema';
