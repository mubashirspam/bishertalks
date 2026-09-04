-- KKR Logistics (India Post) — the channel that was being described as two
-- other things.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- KKR takes a batch of parcels and posts them at Calicut HO under their OWN
-- India Post account. That is a third channel, and until now this database had
-- no row for it, so every parcel that went that way had to be filed under a
-- courier that was wrong in one of two directions:
--
--   KKR Logistics (Delhivery / Manual)   right partner, wrong carrier. The
--       parcel is with India Post, but `config.tracking` says delhivery, so
--       the poller asks Delhivery about an article number they have never
--       heard of and the parcel shows no tracking at all.
--   India Post — Speed Post              right carrier, wrong everything else.
--       Different account, different contract, and not Speed Post: these are
--       BUSINESS_PARCEL bookings under a Registered Bulk Customer contract.
--
-- The 01/09/2026 batch was routed the second way as a stopgap, on the grounds
-- that tracking mattered more than the name. This row is what that stopgap was
-- standing in for, and those parcels move here.
--
-- WHY A NEW ROW RATHER THAN REUSING ONE
--
-- The opposite of 0050's reasoning, and for the same underlying test: is this
-- the same channel wearing a different name, or a different channel? There
-- `delhivery-sheet` WAS the channel being restored — same partner, same
-- carrier, same BISH references, one continuous history. Here the account
-- itself differs. India Post allots article numbers to an ACCOUNT, and these
-- parcels are numbered out of KKR's allotment (customer 1419273334, contract
-- 41310104), not ours (1171865272 / 41767647). Filing them under speed-post
-- would put two contracts' numbers in one pool, which is exactly what
-- postalStockOwner in lib/db/postal-barcodes.ts groups by contract to prevent.
--
-- Its stock is therefore its own, and empty on purpose: we hold no allotted
-- range under KKR's contract, because the numbers are given out at their
-- counter. /admin/delivery will report no articles available for this courier,
-- and that is the true answer — a parcel goes out on this channel by being
-- handed to KKR, and its article number arrives afterwards in their export.
--
-- handoff 'manual' says precisely that: hand it over or post it, then type the
-- tracking number in. It also makes referenceIsPrivate true, which is correct —
-- KKR's counter issues the article number and never sees ours.

INSERT INTO couriers (name, slug, handoff, config, sort_order, is_active)
SELECT
  'KKR Logistics (India Post)',
  'kkr-india-post',
  'manual',
  -- tracking: the whole point. Reads as India Post, so the tracking upload on
  -- /admin/couriers, the webhook and the poller all recognise these parcels.
  --
  -- customer_id / contract_id: KKR's, read off their own booking export. They
  -- are what keeps this courier's article stock separate from ours; see the
  -- note above.
  --
  -- sheet_title reaches the shipping label as its caption (postalLabelCaption).
  -- "INDIA POST PARCEL CONTRACTUAL" is OUR account's heading and would be a
  -- false claim on a parcel posted under KKR's, so this says what the booking
  -- itself says. Worth confirming against KKR's paperwork before printing a
  -- label for this channel.
  --
  -- from_*: the sender India Post has on record for these bookings, from the
  -- same export. No phone: their export does not carry one, and inventing one
  -- for a label is worse than letting it fall back.
  '{"tracking": "india-post",
    "customer_id": "1419273334",
    "contract_id": "41310104",
    "sheet_title": "INDIA POST BUSINESS PARCEL",
    "from_name": "KKR LOGISTICS",
    "from_address": "Mavoor Road, Kozhikode, Kerala 673004"}'::jsonb,
  -- Beside the other two KKR rows (10, 15) rather than with the postal ones,
  -- because the question being answered when someone picks a courier is who is
  -- taking the parcel.
  16,
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM couriers WHERE slug = 'kkr-india-post');

NOTIFY pgrst, 'reload schema';
