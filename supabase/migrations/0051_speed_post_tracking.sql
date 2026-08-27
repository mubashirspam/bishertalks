-- Speed Post becomes a courier we can ask.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- Until now the India Post row carried `config: {}` with this note, from 0037:
--
--     No tracking key: there is no API to ask. The screens read the absence of
--     one and stop offering Sync, waybill columns and everything else that
--     would imply a confirmation is coming.
--
-- That was true when it was written and is not any more. lib/india-post/track.ts
-- and status.ts exist, the event vocabulary has been checked against India
-- Post's own published event lists, and the carrier adapter seam
-- (lib/couriers/adapters) now routes a courier's tracking through whichever
-- carrier `config.tracking` names.
--
-- So this row gets a tracking key, and with it: the Sync button, the waybill
-- column, a place in the per-carrier poller, and `handover_state` progressing
-- past 'handed_over' instead of stopping there.
--
-- ── What this does NOT turn on ────────────────────────────────────────────
--
-- Sending. `handoff` stays 'manual' and the India Post adapter declares
-- `book: false`, because lib/india-post/booking.ts does not exist yet. Both
-- have to agree before a Send button is drawn — see canSendAutomatically in
-- lib/couriers/types.ts. Parcels are still carried to the counter by hand and
-- the article number typed in afterwards; the difference is that from now on
-- the number is followed instead of forgotten.
--
-- ── It does nothing until credentials work ───────────────────────────────
--
-- `indiaPostReadiness` needs INDIA_POST_USERNAME and INDIA_POST_PASSWORD, and
-- their UAT host has been resetting every TLS handshake since before this was
-- written (docs/india-post-uat-outage.md). Until that is resolved the poller
-- reports this carrier as `not configured` and skips it, which is the correct
-- and quiet behaviour — no errors, no half-written scans.
--
-- Applying it early is deliberate. When credentials do start working, tracking
-- begins on the next poll with no deploy.

UPDATE couriers
SET
  config = config
    -- Which carrier answers for these parcels. Read by trackAdapterFor(),
    -- courierIdsForTracking() and the portal_orders view's `courier_tracks`.
    || '{"tracking": "india-post"}'::jsonb,
  updated_at = NOW()
WHERE slug = 'speed-post';

-- If 0037 was skipped on this database, there is no row to update. Create it
-- in the shape the adapter expects. The customer and contract numbers are the
-- real contractual account already printed on every docket we post.
INSERT INTO couriers (name, slug, handoff, config, sort_order, is_active)
SELECT
  'India Post — Speed Post',
  'speed-post',
  'manual',
  '{"tracking": "india-post",
    "customer_id": "1171865272",
    "contract_id": "41767647",
    "sheet_title": "INDIA POST PARCEL CONTRACTUAL"}'::jsonb,
  30,
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM couriers WHERE slug = 'speed-post');

NOTIFY pgrst, 'reload schema';
