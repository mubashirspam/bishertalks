-- Delivery agents get the portal, and only the portal.
--
-- The role PRESET in lib/permissions.ts changed to ['delivery.portal'], but a
-- preset only fills in the permissions array when an account is created — the
-- array is the truth, and every existing agent still carries the old queue
-- permissions. Without this, the change is cosmetic: agents keep seeing
-- /admin/delivery, its label printing and its bulk actions.
--
-- What this does: for every account whose role is 'delivery', replace the
-- permissions array with exactly {delivery.portal}.
--
--   before  {delivery.view, delivery.print, delivery.status}
--   after   {delivery.portal}
--
-- Scope is deliberately narrow. Only role = 'delivery' is touched — a manager
-- or a hand-tuned support account keeps whatever it was given, and owners are
-- untouched because the owner role short-circuits every permission check
-- anyway (see `can` in lib/permissions.ts).
--
-- To reverse: UPDATE staff SET permissions = ARRAY['delivery.view',
-- 'delivery.print', 'delivery.status', 'delivery.portal'] WHERE role = 'delivery';

UPDATE staff
SET permissions = ARRAY['delivery.portal'],
    updated_at  = NOW()
WHERE role = 'delivery'
  -- Idempotent: re-running changes nothing once the array already matches.
  AND permissions IS DISTINCT FROM ARRAY['delivery.portal'];
