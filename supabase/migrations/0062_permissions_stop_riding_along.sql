-- Three screens that were somebody else's free extra.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- Permissions are checked by name against the array on `staff` (see
-- lib/permissions.ts), and three screens had no name of their own:
--
--   /admin            the dashboard      answered to `orders.view`
--   /admin/analytics  the parcel report  answered to `delivery.view`
--   /admin/orders/new a direct sale      answered to `orders.edit`
--
-- So "let them look up an order" also handed over the day's takings, the
-- month's revenue and the charts. "Let them work the delivery queue" also
-- handed over every parcel's age and the spreadsheet of the lot. Neither was
-- a decision anybody made; both were what happened when a new screen borrowed
-- the nearest existing capability.
--
-- The code now checks `dashboard.view`, `analytics.view` and `orders.create`.
-- Nobody holds those yet, so without this file every manager loses three
-- screens the moment it deploys.
--
-- WHAT THIS GRANTS, AND WHY EACH ONE
--
-- Owners are untouched: `can()` short-circuits on the role, so their array has
-- never listed anything.
--
--   dashboard.view   managers only. This is the change that was asked for —
--                    support and anyone given the order list to look things up
--                    in stop seeing the shop's income. Grant it per account on
--                    the staff screen if somebody should have it back.
--
--   analytics.view   everyone who has `delivery.view` today. The parcel report
--                    is the screen that answers "where is my book", it carries
--                    no money — parcels and days, never margin — and taking it
--                    away from the people already using it would be a second
--                    change nobody asked for. It is separable from now on,
--                    which is the point.
--
--   orders.create    everyone who has `orders.edit` today, for the same
--                    reason: they could add a direct sale yesterday.
--
-- Written as three UPDATEs rather than one, because each has its own WHERE and
-- a combined statement would have to encode all three conditions in a CASE
-- that nobody could read six months from now.
--
-- Safe to re-run: every statement refuses a row that already holds the
-- capability, so a second run reports 0 and changes nothing.

-- The takings screen. Managers keep it; everybody else asks for it.
UPDATE staff
SET permissions = array_append(permissions, 'dashboard.view'),
    updated_at  = NOW()
WHERE role = 'manager'
  AND NOT ('dashboard.view' = ANY(permissions));

-- The parcel report. Whoever can see the delivery queue today keeps it.
UPDATE staff
SET permissions = array_append(permissions, 'analytics.view'),
    updated_at  = NOW()
WHERE 'delivery.view' = ANY(permissions)
  AND NOT ('analytics.view' = ANY(permissions));

-- Counter sales. Whoever can change an order today could already add one.
UPDATE staff
SET permissions = array_append(permissions, 'orders.create'),
    updated_at  = NOW()
WHERE 'orders.edit' = ANY(permissions)
  AND NOT ('orders.create' = ANY(permissions));

-- What each account ended up with, so the run can be read rather than trusted.
SELECT email,
       role,
       'dashboard.view' = ANY(permissions) AS dashboard,
       'analytics.view' = ANY(permissions) AS parcel_report,
       'orders.create'  = ANY(permissions) AS direct_sale
FROM staff
ORDER BY role, email;
