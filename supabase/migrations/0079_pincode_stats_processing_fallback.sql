-- 0078's "packed within 5 days" measurement used `processing_at` alone as the
-- start of the clock, and that column only exists from migration 0070 on —
-- checked against live data just after applying 0078: 983 of 1000 delivered
-- Delhivery-family orders have no `processing_at` at all, so they could never
-- be counted as "fast" no matter how quickly they actually went out. Every
-- pincode came back not-eligible, correctly reflecting broken math rather
-- than a real answer.
--
-- `courier_entered_at` (0016 — "address is in the courier's own system") is
-- set on all 1000 of those same orders and lands close enough to packing to
-- stand in for it on the orders that predate 0070. Falling back to it turns
-- "measurable" from 17 orders into 1000, with a real fast/slow split (714
-- fast / 286 slow) instead of a wall of zeroes.

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

  SELECT
    count(*) FILTER (WHERE o.status = 'delivered'),
    count(*) FILTER (
      WHERE o.status = 'delivered'
        AND coalesce(o.processing_at, o.courier_entered_at) IS NOT NULL
        AND o.delivered_at IS NOT NULL
        AND o.delivered_at - coalesce(o.processing_at, o.courier_entered_at) <= INTERVAL '5 days'
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

-- Re-run the backfill with the corrected function so existing rows don't sit
-- wrong until their next delivery event happens to recompute them.
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
-- Apply this by hand, then re-check:
--   SELECT count(*), count(*) FILTER (WHERE delhivery_eligible)
--   FROM pincode_delivery_stats;
-- The eligible count should now be a real, non-zero number if any pincode's
-- Delhivery deliveries have genuinely been fast and reliable.
-- ----------------------------------------------------------------------------

