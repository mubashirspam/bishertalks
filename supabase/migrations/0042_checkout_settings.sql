-- The promo code field, switchable from the admin.
--
-- The box is the problem, not the codes. An input labelled PROMO CODE sitting
-- above the pay button asks a question of everyone who sees it — "what is that,
-- and am I missing something?" — and most customers here have no code and were
-- never meant to. Enough of them ask that it is costing more attention than the
-- codes are earning.
--
-- So the field gets a switch, the same way wrapping did (0029). Off hides it at
-- checkout; the codes themselves are untouched and start working again the
-- moment it is switched back on.
--
-- What this does NOT turn off is referrals. A referral discount is applied from
-- the attribution cookie by `applyReferral`, never from anything typed into
-- this box, so a referral link keeps discounting an order with the field
-- hidden. That is deliberate: the two are different mechanisms that happen to
-- both end in `discount_paise`.
--
-- Its own table rather than another column on gift_settings: that row is about
-- gifts, and "what does the checkout show" is a different question that will
-- get asked again. Single row, the same BOOLEAN-primary-key trick as
-- gift_settings and referral_settings — there is one checkout.

CREATE TABLE IF NOT EXISTS checkout_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

  -- Off hides the promo field entirely rather than showing it disabled. A box
  -- greyed out with no explanation reads as a broken page at the exact moment
  -- someone is deciding whether to trust you with a card.
  --
  -- TRUE by default so applying this migration changes nothing on its own —
  -- the field is on today, and turning it off should be a decision somebody
  -- makes on the admin screen, not something a deploy does quietly.
  promo_field_is_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO checkout_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Deny by default, like every other settings table here. Nothing in this row is
-- secret — the checkout page reveals it to anyone who looks — but the anon key
-- ships to every browser, and a writable settings row is a way to put a promo
-- field back on a checkout that was meant to have none.
ALTER TABLE checkout_settings ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
