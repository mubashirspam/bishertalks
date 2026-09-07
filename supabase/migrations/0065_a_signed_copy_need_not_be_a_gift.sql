-- Signing stops being something only a gift can have.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- 0040 added `CHECK (NOT is_signed OR is_gift)`, and its reasoning was sound
-- for the checkout it was written against:
--
--   "Signing is sold inside the gift option and nowhere else. Without this an
--    order could be flagged for signing with no wrapping and no card, which is
--    not a thing that was ever on sale."
--
-- That was true of what the WEBSITE sells. It stopped being true when direct
-- sales arrived (0061). A book handed over at the counter, or posted to a head
-- master because somebody asked Bisher to sign it, is not a gift order: there
-- is no wrapping, no card and no gift charge. It is a signed book.
--
-- The evidence that the rule outlived its scope is in the direct-sale form
-- itself, which offers a "Signed copy" checkbox with no gift checkbox anywhere
-- near it. Ticking it could never save — the insert was refused by this
-- constraint with a message about a check nobody reading the form could have
-- predicted. The form was written for what the shop actually does; the
-- constraint was still describing the old catalogue.
--
-- WHAT IS AND IS NOT RELAXED
--
-- Only the "signed implies gift" rule goes. `orders_signed_charge_check` stays
-- exactly as it is: signing is free (0041), so `signed_charge_paise` is 0 on
-- every row, and the rule that an unsigned order cannot carry a signing charge
-- is still worth enforcing. Dropping both because one is wrong is how a
-- constraint nobody meant to lose disappears.
--
-- Nothing is backfilled and no row changes. Every existing signed order is a
-- gift order and stays one; this only stops refusing the combination that
-- direct sales need.

DO $$
BEGIN
  ALTER TABLE orders DROP CONSTRAINT orders_signed_needs_gift_check;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'orders_signed_needs_gift_check is already gone';
END $$;

COMMENT ON COLUMN orders.is_signed IS
  'Sign every copy in this parcel before it is packed. Sold inside the gift '
  'option at checkout, and set on its own for a direct sale — a signed book is '
  'not necessarily a wrapped one (0065). Always free; see 0041.';
