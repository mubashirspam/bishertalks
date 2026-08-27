-- KKR Logistics (Delhivery Manual) — the sheet channel, brought back on purpose.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- Delhivery's integration team confirmed what INTEGRATED_SLUGS in
-- lib/couriers/types.ts already suspected: /api/cmu/create.json is the only way
-- to put an order into their system, and it manifests. Pushing IS manifesting.
-- A waybill comes back in the same response, and there is no create-as-pending
-- call on this account. Their words: "the waybill is manifested immediately
-- when the manifest API is called", and the pending-then-manually-manifest
-- behaviour is a *channel integration* — a One panel feature, not part of the
-- shipping API set.
--
-- So rather than re-architect who owns the waybill, this restores the flow that
-- worked before: we produce the spreadsheet, KKR uploads and manifests it
-- themselves, and we read the scans back afterwards. Nothing about that needed
-- inventing — the `sheet` handoff has existed since 0030 and `config.tracking`
-- has always been independent of it, precisely so a partner we hand a file to
-- can still have an API that answers.
--
-- WHY THE OLD ROW RATHER THAN A NEW ONE
--
-- `delhivery-sheet` is this exact channel. It was seeded in 0030, deactivated
-- in 0038 when the model collapsed to one courier, and it is the historical
-- home of every parcel routed this way before. It already maps to the `BISH`
-- reference prefix in REFERENCE_CODES — the prefix KKR has years of sheets
-- under and the one Delhivery's reference lookup answers for. A new slug would
-- need that mapping added, would split one channel's history across two rows,
-- and would gain nothing.
--
-- WHAT IS ACTUALLY NEW
--
-- `require_serviceable`. Everywhere else an unserviceable pincode routes anyway
-- and is reported; here it refuses before assigning. The difference is where
-- the mistake surfaces: with handoff 'api' a bad pincode comes back as a
-- refused manifest in seconds, but on a sheet it is discovered at KKR's counter
-- after the parcel has been packed and carried there. Only a definite `false`
-- refuses — an unreachable lookup still routes, because blocking a day's
-- dispatch on a secondary API is worse than the problem it prevents.

UPDATE couriers
SET
  name       = 'KKR Logistics (Delhivery Manual)',
  handoff    = 'sheet',
  is_active  = TRUE,
  sort_order = 15,
  config     = config
    -- Same franchise, same physical parcel, same service. Only the handoff
    -- differs from the row above it.
    || '{"pickup_location": "KKR LOGISTICS FRANCHISE"}'::jsonb
    || '{"mode": "surface"}'::jsonb
    -- The whole point: no send integration, but a full tracking one. Parcels
    -- are found by courier_reference (BISH…), which is the Reference No printed
    -- on the sheet KKR uploads — trackReferencesResilient in
    -- lib/delhivery/track.ts is what reads them back.
    --
    -- This key is also what delhiveryCourierIds() filters on, so this courier
    -- is picked up by Sync, the poller and the reconciliation export with no
    -- further change.
    || '{"tracking": "delhivery"}'::jsonb
    || '{"require_serviceable": true}'::jsonb,
  updated_at = NOW()
WHERE slug = 'delhivery-sheet';

-- If 0030's seed never ran on this database, create it. Same shape.
INSERT INTO couriers (name, slug, handoff, config, sort_order, is_active)
SELECT
  'KKR Logistics (Delhivery Manual)',
  'delhivery-sheet',
  'sheet',
  '{"pickup_location": "KKR LOGISTICS FRANCHISE",
    "mode": "surface",
    "tracking": "delhivery",
    "require_serviceable": true}'::jsonb,
  15,
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM couriers WHERE slug = 'delhivery-sheet');

-- The API row is untouched and stays exactly as it is. Both are now offered on
-- the delivery screen, and the choice is a real one: 'KKR Logistics
-- (Delhivery)' sends over the API and manifests immediately; this one produces
-- the sheet and lets KKR manifest.

NOTIFY pgrst, 'reload schema';
