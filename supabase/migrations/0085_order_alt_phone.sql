-- A second number to reach the customer on.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- The checkout and the post-payment address form now ask for an optional
-- alternative number: the parcel goes to a house where the buyer is often not
-- the one who answers the courier's call, and "Consignee Unavailable" is the
-- most common reason a parcel comes back.
--
-- Ten digits, stored the way buyer_phone is. Nullable — most customers leave
-- it blank. It is NOT a login and moves no course access; buyer_phone is still
-- the one number that identifies the customer.
--
-- The routes that write it (/api/orders/create, /api/orders/address) retry
-- without it if this column doesn't exist yet, so deploying the code before
-- running this loses only the alternative number, never the order.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS alt_phone text;

NOTIFY pgrst, 'reload schema';
