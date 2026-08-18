-- Put the parcels Delhivery actually has onto the Delhivery courier.
--
-- 0030 backfilled every sheeted parcel onto 'delhivery-sheet', because at that
-- point the only thing we knew was how they had left the building. We now know
-- something better: which of them Delhivery actually received. Of 738 sheeted
-- parcels, 571 came back with a waybill and 167 did not exist at Delhivery
-- under either our reference number or our order number.
--
-- So the two rows stop meaning "how it left" and start meaning something an
-- operator can act on:
--
--   Delhivery                 the courier has it. Waybill, live scans, real
--                             status. 571 parcels.
--   Delhivery — Excel sheet   we put it on a sheet and it never arrived. The
--                             pile to chase. 167 parcels.
--
-- Nothing is deleted and nothing is detached: every order keeps its
-- courier_reference, its waybill, its scan and its history. This moves a
-- foreign key and nothing else, and it is reversible by inverting the WHERE.
--
-- The waybill is the test, not the status. A parcel Delhivery has marked
-- Pending is still a parcel Delhivery has.

UPDATE orders o
SET courier_id = (SELECT id FROM couriers WHERE slug = 'delhivery'),
    updated_at = NOW()
WHERE o.courier_id = (SELECT id FROM couriers WHERE slug = 'delhivery-sheet')
  AND o.tracking_number IS NOT NULL
  AND o.tracking_number <> '';

-- Say plainly what each row now holds, since the names alone no longer do.
UPDATE couriers
SET name = 'Delhivery — not received',
    updated_at = NOW()
WHERE slug = 'delhivery-sheet';

NOTIFY pgrst, 'reload schema';
