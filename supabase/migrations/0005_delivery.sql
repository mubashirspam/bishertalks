-- Delivery / fulfilment.
--
-- Orders are managed in two halves. Everything up to payment lives in the
-- funnel (see 0004): lead → payment started → paid. Once an order is paid AND
-- has a delivery address it leaves the funnel and enters the delivery queue,
-- which is a different job done by a different person at a different time.
--
-- The queue stage is DERIVED, same as the funnel stage, from `status` plus
-- whether the address label has been printed:
--
--   to_print          status IN ('confirmed','processing') AND label_downloaded_at IS NULL
--   packed            status IN ('confirmed','processing') AND label_downloaded_at IS NOT NULL
--   shipped           status = 'shipped'
--   out_for_delivery  status = 'out_for_delivery'
--   delivered         status = 'delivered'
--   cancelled         status = 'cancelled'

-- ── Label printing ──────────────────────────────────────────────────────────
-- Printing the address label is the real "we've started packing this" signal,
-- so it's recorded rather than inferred. First print only — reprints must not
-- move the date the customer was told their order was packed.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS label_downloaded_at TIMESTAMPTZ;

-- Reprints. A label printed three times usually means something went wrong
-- with that parcel, which is worth seeing in the list.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS label_download_count INTEGER NOT NULL DEFAULT 0;

-- ── Milestone timestamps ────────────────────────────────────────────────────
-- `updated_at` only remembers the most recent change, so it can't answer "when
-- was this shipped". These can, and they're what the customer's tracking page
-- shows next to each completed step.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Best-effort backfill for orders already past those points. `updated_at` is
-- the closest thing we have; without it their tracking page would show a
-- delivered order with no dates at all.
UPDATE orders SET shipped_at = updated_at
  WHERE shipped_at IS NULL
    AND status IN ('shipped', 'out_for_delivery', 'delivered');
UPDATE orders SET delivered_at = updated_at
  WHERE delivered_at IS NULL AND status = 'delivered';

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Everything shippable: the delivery list's base scope.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_queue
  ON orders (created_at DESC)
  WHERE payment_status = 'paid' AND address_line1 IS NOT NULL;

-- The one bucket that's worked every day: paid, addressed, not yet printed.
-- Ascending, because labels are printed oldest-first.
CREATE INDEX IF NOT EXISTS idx_orders_to_print
  ON orders (created_at)
  WHERE payment_status = 'paid'
    AND address_line1 IS NOT NULL
    AND label_downloaded_at IS NULL;

-- ── Bulk operations ─────────────────────────────────────────────────────────
-- Both of these exist because the admin acts on up to a few hundred orders at
-- once and each needs a per-row conditional (COALESCE / CASE) that PostgREST
-- can't express. Doing it in SQL keeps a bulk action to one atomic round trip
-- instead of N updates that can half-apply.

-- Called after a label PDF is generated. Sets the print date once, counts
-- reprints, and nudges a still-'confirmed' order to 'processing' so the
-- customer sees movement the moment we start packing.
CREATE OR REPLACE FUNCTION mark_labels_downloaded(p_order_numbers TEXT[])
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET
    label_downloaded_at  = COALESCE(label_downloaded_at, NOW()),
    label_download_count = label_download_count + 1,
    status               = CASE WHEN status = 'confirmed' THEN 'processing' ELSE status END,
    updated_at           = NOW()
  WHERE order_number = ANY(p_order_numbers)
    AND payment_status = 'paid'
  RETURNING order_number;
$$;

-- Bulk fulfilment status change. Milestone timestamps are set on first entry
-- only, so re-marking an order as shipped doesn't rewrite history. Returns the
-- orders it actually touched, which is what the caller notifies on.
--
-- p_courier is optional and set for the whole batch: a day's parcels go out
-- with one courier, and the "shipped" WhatsApp message reads badly without it.
-- Tracking numbers stay per-order, on the order detail page.
CREATE OR REPLACE FUNCTION set_delivery_status(
  p_order_numbers TEXT[],
  p_status        TEXT,
  p_courier       TEXT DEFAULT NULL
)
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET
    status       = p_status,
    courier_name = COALESCE(NULLIF(p_courier, ''), courier_name),
    shipped_at   = CASE WHEN p_status IN ('shipped', 'out_for_delivery')
                        THEN COALESCE(shipped_at, NOW()) ELSE shipped_at END,
    delivered_at = CASE WHEN p_status = 'delivered'
                        THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
    updated_at   = NOW()
  -- No payment_status guard here, unlike the label functions: cancelling an
  -- order that was never paid is a legitimate thing for an admin to do from
  -- the order detail page, which shares this path.
  WHERE order_number = ANY(p_order_numbers)
  RETURNING order_number;
$$;

-- Undo a print, for when a label came out of the printer unusable.
CREATE OR REPLACE FUNCTION unmark_labels_downloaded(p_order_numbers TEXT[])
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET
    label_downloaded_at  = NULL,
    label_download_count = 0,
    updated_at           = NOW()
  WHERE order_number = ANY(p_order_numbers)
    AND payment_status = 'paid'
  RETURNING order_number;
$$;

-- These are deliberately NOT security definer, and are reachable only by the
-- service role. The anon key is shipped to every browser; a publicly callable
-- function that writes order status by order number would let anyone mark
-- anyone's order delivered.
DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'mark_labels_downloaded(text[])',
    'unmark_labels_downloaded(text[])',
    'set_delivery_status(text[], text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- PostgREST caches the function signatures it exposes; without this the new
-- RPCs can 404 until the API restarts on its own.
NOTIFY pgrst, 'reload schema';
