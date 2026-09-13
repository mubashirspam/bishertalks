-- Which pincodes has KKR's Delhivery service actually been fast and reliable
-- for, versus which ones just haven't earned that yet.
--
-- Two signals already existed and disagreed with nobody, because nothing read
-- either of them together: `courier_serviceability` (0034) is Delhivery's own
-- pincode-lookup answer, and `orders.status` / `processing_at` / `delivered_at`
-- is what actually happened when we shipped there. This table is the join of
-- the two, kept current by triggers rather than a report run by hand — a
-- pincode that just returned a parcel, or that a courier partner just
-- rejected as unserviceable, drops out of "Delhivery-ready" the moment that
-- happens, not whenever someone next remembers to recompute it.
--
-- The rule (owner's own words): a pincode is Delhivery-ready only once it has
-- at least 3 delivered parcels there AND at least 90% of them went from
-- packed to delivered within 5 days. A brand-new pincode starts NOT ready —
-- it has to earn the fast lane, not default into it. A courier_serviceability
-- refusal (from the automated pincode check, OR from a courier partner
-- rejecting a parcel and saying so — see rejectCourierAssignment) overrides
-- the history and forces it back to not-ready regardless of a good track
-- record, since a courier just telling us "no" is worth more than old data.

CREATE TABLE IF NOT EXISTS pincode_delivery_stats (
  pincode TEXT PRIMARY KEY,
  state TEXT,
  district TEXT,
  delivered_count INT NOT NULL DEFAULT 0,
  -- Of delivered_count, how many went packed -> delivered within 5 days.
  fast_delivered_count INT NOT NULL DEFAULT 0,
  returned_count INT NOT NULL DEFAULT 0,
  delhivery_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pincode_delivery_stats ENABLE ROW LEVEL SECURITY;
-- No policy for anon/authenticated, same as courier_serviceability and staff
-- (0007/0034) — read and written only by server code on the service role.

-- ----------------------------------------------------------------------------
-- Recompute one pincode's row from scratch. Cheap enough to run per-pincode on
-- every event that could change the answer — a delivery, a return, or a fresh
-- "not serviceable" — rather than batching a report nobody remembers to run.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recompute_pincode_delivery_stats(p_pincode TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_delivered INT;
  v_fast INT;
  v_returned INT;
  v_state TEXT;
  v_district TEXT;
  v_unserviceable BOOLEAN;
BEGIN
  IF p_pincode IS NULL OR p_pincode = '' THEN
    RETURN;
  END IF;

  -- Both KKR-Delhivery rows count as "went via Delhivery" — the API-integrated
  -- one and the manual/sheet one are the same physical network on our two
  -- different our-side handoff paths (see docs/delivery-model.md).
  SELECT
    count(*) FILTER (WHERE o.status = 'delivered'),
    count(*) FILTER (
      WHERE o.status = 'delivered'
        AND o.processing_at IS NOT NULL
        AND o.delivered_at IS NOT NULL
        AND o.delivered_at - o.processing_at <= INTERVAL '5 days'
    ),
    count(*) FILTER (WHERE o.status = 'returned'),
    max(o.state),
    max(o.district)
  INTO v_delivered, v_fast, v_returned, v_state, v_district
  FROM orders o
  JOIN couriers c ON c.id = o.courier_id
  WHERE o.pincode = p_pincode
    AND c.slug IN ('delhivery', 'delhivery-sheet');

  SELECT EXISTS (
    SELECT 1 FROM courier_serviceability cs
    JOIN couriers c ON c.id = cs.courier_id
    WHERE cs.pincode = p_pincode
      AND c.slug IN ('delhivery', 'delhivery-sheet')
      AND cs.serviceable = FALSE
  ) INTO v_unserviceable;

  INSERT INTO pincode_delivery_stats (
    pincode, state, district, delivered_count, fast_delivered_count,
    returned_count, delhivery_eligible, computed_at
  )
  VALUES (
    p_pincode, v_state, v_district, coalesce(v_delivered, 0), coalesce(v_fast, 0),
    coalesce(v_returned, 0),
    coalesce(v_delivered, 0) >= 3
      AND coalesce(v_fast, 0)::numeric / NULLIF(v_delivered, 0) >= 0.9
      AND NOT coalesce(v_unserviceable, FALSE),
    NOW()
  )
  ON CONFLICT (pincode) DO UPDATE SET
    state = EXCLUDED.state,
    district = EXCLUDED.district,
    delivered_count = EXCLUDED.delivered_count,
    fast_delivered_count = EXCLUDED.fast_delivered_count,
    returned_count = EXCLUDED.returned_count,
    delhivery_eligible = EXCLUDED.delhivery_eligible,
    computed_at = EXCLUDED.computed_at;
END;
$$;

-- ----------------------------------------------------------------------------
-- Keep it current: a delivery, a return, or a fresh serviceability answer
-- each recompute just their own pincode — never a full-table rebuild.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_pincode_stats_on_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('delivered', 'returned') AND NEW.pincode IS NOT NULL THEN
    PERFORM recompute_pincode_delivery_stats(NEW.pincode);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pincode_stats_on_order_trigger ON orders;
CREATE TRIGGER pincode_stats_on_order_trigger
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('delivered', 'returned'))
EXECUTE FUNCTION trg_pincode_stats_on_order();

CREATE OR REPLACE FUNCTION trg_pincode_stats_on_serviceability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM recompute_pincode_delivery_stats(NEW.pincode);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pincode_stats_on_serviceability_trigger ON courier_serviceability;
CREATE TRIGGER pincode_stats_on_serviceability_trigger
AFTER INSERT OR UPDATE ON courier_serviceability
FOR EACH ROW EXECUTE FUNCTION trg_pincode_stats_on_serviceability();

-- ----------------------------------------------------------------------------
-- Backfill: seed the table from history that already exists, so the filter
-- has real answers the moment this is applied rather than waiting for the
-- next delivery in each pincode.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  p TEXT;
BEGIN
  FOR p IN
    SELECT DISTINCT pincode FROM orders
    WHERE pincode IS NOT NULL AND pincode <> ''
  LOOP
    PERFORM recompute_pincode_delivery_stats(p);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Apply this by hand like 0001-0077, then check:
--   SELECT count(*), count(*) FILTER (WHERE delhivery_eligible)
--   FROM pincode_delivery_stats;
-- should show a real number of pincodes with a non-zero eligible count if
-- KKR's Delhivery service has genuinely been fast in some of them.
-- ----------------------------------------------------------------------------
