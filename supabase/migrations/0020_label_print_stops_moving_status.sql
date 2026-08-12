-- Printing a label no longer packs the parcel.
--
-- mark_labels_downloaded (migration 0005) nudged a still-'confirmed' order to
-- 'processing', so the customer saw movement the moment we started packing.
-- That was true when printing a label *was* the packing: one person, one
-- printer, and the sheet came out as the box was filled.
--
-- It stopped being true in 0019. Printing is now how a batch gets handed to a
-- delivery agent, and the agent packs it afterwards — so the bump was marking
-- work that hadn't happened yet. Worse, it landed on the portal as two ticks,
-- not one: the grid reads a parcel at Packed as Confirmed too, on the
-- reasoning that you cannot pack a parcel you never entered with the courier.
-- An agent opened their screen to find a fresh assignment already claiming
-- they had entered the address AND packed the box.
--
-- Assignment is now the only thing "print & assign" does to a parcel's state.
-- Confirmed and Packed are the agent's to tick, in the portal, when they've
-- actually done them.
--
-- Existing orders are left exactly as they are. Anything already at
-- 'processing' was moved there by the old rule and may well have been packed;
-- rewriting that history would replace a wrong guess with a different wrong
-- guess. This changes what happens from here on.

CREATE OR REPLACE FUNCTION mark_labels_downloaded(p_order_numbers TEXT[])
RETURNS SETOF TEXT
LANGUAGE sql
AS $$
  UPDATE orders SET
    label_downloaded_at  = COALESCE(label_downloaded_at, NOW()),
    label_download_count = label_download_count + 1,
    -- No status change. See above.
    updated_at           = NOW()
  WHERE order_number = ANY(p_order_numbers)
    AND payment_status = 'paid'
  RETURNING order_number;
$$;

-- CREATE OR REPLACE resets grants on some Postgres versions, and this one
-- writes order state by order number — service role only, as in 0005.
REVOKE ALL ON FUNCTION mark_labels_downloaded(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_labels_downloaded(text[]) TO service_role;

NOTIFY pgrst, 'reload schema';
