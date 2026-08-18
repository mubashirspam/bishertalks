-- Tracking is not the same capability as sending.
--
-- 0030 gave each courier a `handoff` — how a parcel physically leaves us — and
-- the code then used that one field to decide whether we could ask the courier
-- where a parcel was. That conflates two different things, and the mistake
-- shows up immediately in our own data:
--
--   738 parcels went out on the Excel sheet. KKR uploaded them to Delhivery by
--   hand, so Delhivery knows every one of them and will happily report their
--   waybill and their scans. But because their handoff is 'sheet', the portal
--   treated them as untrackable and offered a spreadsheet instead of the live
--   status that was sitting there for the asking.
--
-- So: `handoff` stays "how does it leave", and `config.tracking` becomes "whose
-- API can tell us where it is". A courier can have one, the other, both, or
-- neither — the Excel row has tracking without sending, and a future partner we
-- post parcels through would have neither.
--
-- Both seeded rows point at Delhivery, because both genuinely end up there.

UPDATE couriers
SET config = config || '{"tracking": "delhivery"}'::jsonb,
    updated_at = NOW()
WHERE slug IN ('delhivery', 'delhivery-sheet');

NOTIFY pgrst, 'reload schema';
