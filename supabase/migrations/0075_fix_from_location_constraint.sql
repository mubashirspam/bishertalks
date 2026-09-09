-- Fixing 0074's own constraint — it rejected the ordinary case.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- `stock_movements_from_location_shape` (0074) checked
-- `from_location IS DISTINCT FROM location`, meant to stop a transfer naming
-- the same shelf as both ends. It does that correctly whenever either side
-- is a real shelf — but `NULL IS DISTINCT FROM NULL` is FALSE in Postgres
-- (two NULLs are not considered distinct from each other), so the single
-- most common row this table holds — a plain correction with no shelf and
-- no source, `location` and `from_location` both NULL — failed the
-- constraint the very first time one was written after this migration
-- applied. Every out_damaged/in_correction/in_returned entered with no
-- shelf picked would have hit this.
--
-- The fix: only compare the two when a transfer actually names a source.
-- Nothing else about the rule changes — a transfer still cannot name the
-- same shelf on both ends.

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_from_location_shape;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_from_location_shape
  CHECK (
    (kind = 'in_transfer' OR from_location IS NULL)
    AND (from_location IS NULL OR from_location IS DISTINCT FROM location)
  );

NOTIFY pgrst, 'reload schema';
