-- Everything Delhivery carries goes on the Delhivery row.
--
-- 0033 split the parcels across two courier rows — "Delhivery" for the ones
-- the courier confirmed, "Delhivery — not received" for the 167 it never got —
-- because at that point the courier row was the only place a difference could
-- be recorded, and finding those 167 mattered more than modelling purity.
--
-- 0035 made that unnecessary. `handover_state` now says what is happening to a
-- parcel, so the courier row can go back to meaning the one thing it should:
-- who is carrying it. And every one of these parcels is carried by Delhivery —
-- KKR is their franchise, not a separate company, so two rows for one courier
-- was always describing our problem rather than the world.
--
-- The 167 do not become invisible. They are `handover_state = 'not_received'`,
-- which survives this move untouched: that state is derived from having a
-- reference, having been handed over, having been checked, and still having no
-- waybill — none of which is the courier row. Filter for it in the portal.
--
-- The sheet row stays, inactive, as the fallback for a Delhivery API outage.
-- It keeps its slug, so lib/couriers can still find it.

UPDATE orders
SET courier_id = (SELECT id FROM couriers WHERE slug = 'delhivery'),
    updated_at = NOW()
WHERE courier_id = (SELECT id FROM couriers WHERE slug = 'delhivery-sheet');

-- Named for what it is again, now that it is not being used to mean "broken".
UPDATE couriers
SET name = 'Delhivery — Excel sheet (fallback)',
    is_active = FALSE,
    updated_at = NOW()
WHERE slug = 'delhivery-sheet';

NOTIFY pgrst, 'reload schema';
