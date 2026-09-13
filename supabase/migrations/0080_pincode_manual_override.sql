-- A place to see pincode_delivery_stats (0078/0079) and correct it by hand.
--
-- The computed rule is a good default but not the last word: an owner who
-- knows a pincode has just gotten a new local hub, or knows a "good" pincode
-- has a specific street the courier keeps failing, needs to be able to say
-- so directly rather than waiting for more delivered/returned history to
-- accumulate the rule's way there on its own.
--
-- `delhivery_eligible` stays the one column everything else already reads
-- (pincodesByFit, the /admin/delivery filter, the row badge) — no
-- application code needs to change. What changes is how it's computed:
-- COALESCE(manual_override, computed_eligible) instead of just the rule.
-- `computed_eligible` is new — the rule's own answer, kept visible
-- separately so the UI can show "computed: not ready, but forced ready by
-- <staff> on <date>" instead of hiding the override ever happened.

ALTER TABLE pincode_delivery_stats
  ADD COLUMN IF NOT EXISTS computed_eligible BOOLEAN,
  ADD COLUMN IF NOT EXISTS manual_override BOOLEAN,
  ADD COLUMN IF NOT EXISTS override_reason TEXT,
  ADD COLUMN IF NOT EXISTS override_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_at TIMESTAMPTZ;

-- Backfill: nothing has been overridden yet, so the computed answer IS the
-- effective one for every existing row.
UPDATE pincode_delivery_stats SET computed_eligible = delhivery_eligible
WHERE computed_eligible IS NULL;

-- ----------------------------------------------------------------------------
-- The rule, unchanged, except it now writes its raw answer to
-- computed_eligible and lets an existing override keep winning over it.
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
  v_computed BOOLEAN;
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

  v_computed := coalesce(v_delivered, 0) >= 3
    AND coalesce(v_fast, 0)::numeric / NULLIF(v_delivered, 0) >= 0.9
    AND NOT coalesce(v_unserviceable, FALSE);

  INSERT INTO pincode_delivery_stats (
    pincode, state, district, delivered_count, fast_delivered_count,
    returned_count, computed_eligible, delhivery_eligible, computed_at
  )
  VALUES (
    p_pincode, v_state, v_district, coalesce(v_delivered, 0), coalesce(v_fast, 0),
    coalesce(v_returned, 0), v_computed, v_computed, NOW()
  )
  ON CONFLICT (pincode) DO UPDATE SET
    state = EXCLUDED.state,
    district = EXCLUDED.district,
    delivered_count = EXCLUDED.delivered_count,
    fast_delivered_count = EXCLUDED.fast_delivered_count,
    returned_count = EXCLUDED.returned_count,
    computed_eligible = EXCLUDED.computed_eligible,
    -- The one line that matters: an admin's override outlives the next
    -- recompute. NULL means nobody has pinned this pincode, so the rule's
    -- own answer stands.
    delhivery_eligible = COALESCE(pincode_delivery_stats.manual_override, EXCLUDED.computed_eligible),
    computed_at = EXCLUDED.computed_at;
END;
$$;

-- ----------------------------------------------------------------------------
-- Apply this by hand like 0078/0079. No backfill loop needed — the UPDATE
-- above already gives every existing row a computed_eligible, and the
-- function only needs to change for pincodes touched from here on.
-- ----------------------------------------------------------------------------
