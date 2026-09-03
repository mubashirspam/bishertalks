-- Marking a parcel delivered on the day it was actually delivered.
--
-- `set_delivery_status` (0005, extended in 0015) stamps NOW(). That is right
-- when an agent ticks a parcel off in the portal, because the tick and the
-- delivery are the same moment. It is wrong for a courier's own record read
-- back afterwards: India Post's delivery export arrives with a week of events
-- in it, and putting NOW() on all of them says every parcel in that file
-- arrived the instant somebody uploaded it.
--
-- WHY THAT MATTERS RATHER THAN BEING UNTIDY. `delivered_at` is not decoration.
-- The reports screen measures days-to-deliver from it, the throughput chart
-- buckets on it, and the ageing figures are the gap between it and the order.
-- A week of deliveries all landing on one timestamp would show six days of
-- nothing and then a spike, and would report the delivery time of every parcel
-- in that file as however long the reconciliation happened to be left.
--
-- A NEW FUNCTION rather than a parameter on the old one. Adding
-- `p_at TIMESTAMPTZ DEFAULT NULL` to `set_delivery_status` would create a
-- second overload with the same name — PostgREST resolves RPC overloads by the
-- argument names it is given, and two functions differing only by an optional
-- parameter is exactly the shape that resolves to the wrong one. The portal's
-- path stays untouched, which is also what anybody debugging it would expect.
--
-- The timestamps are a PARALLEL ARRAY: p_at[i] belongs to p_order_numbers[i].
-- The alternative is one call per distinct timestamp, and a file of a thousand
-- deliveries has a thousand distinct timestamps.

CREATE OR REPLACE FUNCTION set_delivery_status_at(
  p_order_numbers TEXT[],
  p_status        TEXT,
  p_at            TIMESTAMPTZ[],
  p_courier       TEXT DEFAULT NULL
)
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders o SET
    status       = p_status,
    courier_name = COALESCE(NULLIF(p_courier, ''), o.courier_name),

    -- COALESCE keeps whatever is already there, exactly as the original does:
    -- a milestone is recorded once and re-marking must not rewrite history.
    -- So re-importing the same file is a no-op on the dates, which is what
    -- makes it safe to upload yesterday's export again by mistake.
    shipped_at   = CASE WHEN p_status IN ('shipped', 'out_for_delivery')
                        THEN COALESCE(o.shipped_at, t.at, NOW()) ELSE o.shipped_at END,
    delivered_at = CASE WHEN p_status = 'delivered'
                        THEN COALESCE(o.delivered_at, t.at, NOW()) ELSE o.delivered_at END,
    returned_at  = CASE WHEN p_status = 'returned'
                        THEN COALESCE(o.returned_at, t.at, NOW()) ELSE o.returned_at END,

    -- NOW(), not t.at. This one is "when did this row last change", and it
    -- did change now — the parcel's history is old, the edit is not.
    updated_at   = NOW()

  -- Zips the two arrays. A NULL timestamp falls back to NOW(), so a row whose
  -- date the courier's file did not carry still gets marked, just without a
  -- better answer than "when we found out".
  FROM unnest(p_order_numbers, p_at) AS t(order_number, at)
  WHERE o.order_number = t.order_number
  RETURNING o.order_number;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A file of scans, recorded in one statement
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `recordScan` in lib/db/courier-send.ts writes one order per call, which is
-- right for a webhook: one push, one parcel. India Post's delivery report is
-- two thousand parcels in one upload, and two thousand round trips does not
-- finish inside a serverless function's timeout — so the same write, in bulk.
--
-- MOST OF THESE PARCELS DO NOT CHANGE STATUS, and recording them is still the
-- point. A parcel reading "Item Dispatched — Kozhikode RMS" on its row is a
-- parcel somebody can stop worrying about; the same parcel with a blank scan
-- column is one they ring the post office about. The status functions above
-- only touch the parcels that moved between two of our stages, which in a
-- typical file is a minority of it.
--
-- The tracking number is written here too, and only where there is not one
-- already. A parcel we booked through their portal was matched by our own
-- reference and has never had India Post's article number stored against it —
-- so the customer's tracking page has nothing to look up. Filling it in from
-- their own file is what makes that page work, and it is what lets the NEXT
-- upload match the same parcel by article number instead.
--
-- COALESCE(NULLIF(...)) rather than a WHERE clause on it: the scan must be
-- recorded on every parcel in the batch, including the ones whose tracking
-- number is already known and must not be overwritten.

CREATE OR REPLACE FUNCTION record_courier_scans(
  p_order_numbers TEXT[],
  p_scan          TEXT[],
  p_at            TIMESTAMPTZ[],
  -- NULL entries leave the order's tracking number alone.
  p_tracking      TEXT[] DEFAULT NULL
)
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders o SET
    courier_last_scan    = LEFT(t.scan, 300),
    courier_last_scan_at = COALESCE(t.at, NOW()),
    tracking_number      = COALESCE(NULLIF(o.tracking_number, ''), t.tracking),
    updated_at           = NOW()
  FROM unnest(
    p_order_numbers,
    p_scan,
    p_at,
    -- A caller that passes no tracking array still has to zip four columns, so
    -- it becomes an array of NULLs the same length as the rest.
    COALESCE(p_tracking, array_fill(NULL::TEXT, ARRAY[array_length(p_order_numbers, 1)]))
  ) AS t(order_number, scan, at, tracking)
  WHERE o.order_number = t.order_number
  RETURNING o.order_number;
$$;

-- Service-role only, for the reason 0005 gives about its siblings: the anon key
-- ships to every browser, and a publicly callable function that writes order
-- status by order number would let anyone mark anyone's parcel delivered.
REVOKE ALL ON FUNCTION set_delivery_status_at(TEXT[], TEXT, TIMESTAMPTZ[], TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_delivery_status_at(TEXT[], TEXT, TIMESTAMPTZ[], TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION record_courier_scans(TEXT[], TEXT[], TIMESTAMPTZ[], TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_courier_scans(TEXT[], TEXT[], TIMESTAMPTZ[], TEXT[])
  TO service_role;

NOTIFY pgrst, 'reload schema';
