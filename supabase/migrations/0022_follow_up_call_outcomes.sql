-- Two more follow-up outcomes: 'connected' and 'not_responded'.
--
-- Migration 0011 gave a lead one open state, 'contacted', meaning "followed up,
-- waiting to hear back". In practice that covers two different situations that
-- need different next actions:
--
--   connected      you got through and spoke to them. The ball is in their
--                  court — wait, then chase the decision.
--   not_responded  the phone rang out, or the message went unanswered. Nobody
--                  has heard anything, and the next action is to try again.
--
-- Marking both as "contacted" meant a list of people to ring back looked
-- identical to a list of people who had already said "let me think about it".
--
-- Both are OPEN states, like 'contacted' — they don't close a lead. Only
-- converted / already_purchased / not_interested do that (see lib/follow-up.ts,
-- FOLLOW_UP_CLOSED).
--
-- 'contacted' is kept rather than migrated onto one of the new two: it is what
-- was recorded at the time, and rewriting it would be inventing a detail about
-- a phone call nobody can now remember.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_follow_up_status_check;

ALTER TABLE orders ADD CONSTRAINT orders_follow_up_status_check
  CHECK (follow_up_status IS NULL OR follow_up_status IN (
    'contacted',
    'connected',
    'not_responded',
    'converted',
    'already_purchased',
    'not_interested'
  ));

NOTIFY pgrst, 'reload schema';
