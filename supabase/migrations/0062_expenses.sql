-- What the business spends, and who fronted the money for it.
--
-- APPLY THIS BY HAND. Migrations here are not run automatically.
--
-- WHY THIS EXISTS
--
-- This shop can say what it earns to the rupee and cannot say what it spends
-- at all. `business_costs` (0026) looks like it answers that and does not: it
-- is a single row of ASSUMPTIONS — "printing costs ₹120 a book", "tech is
-- ₹4,000 a month" — typed in to drive projections. It records no transaction.
-- Not one printing invoice, not one packing purchase, not one month of server
-- billing. Every profit figure on /admin/reports is therefore a model, and
-- nobody can say what last month actually made.
--
-- The second gap is the one with an argument in it. Purchases are funded by
-- three different people — Bisher (the company), Mubashir and Nizam — and when
-- Mubashir pays a printer ₹40,000 the company owes Mubashir ₹40,000. Today
-- that fact lives in somebody's memory and a WhatsApp thread. This gives it a
-- row, a running balance, and a settlement record when it is paid back.
--
-- WHY NOT JUST ADD COLUMNS TO `business_costs`
--
-- Because they are different kinds of fact and they must not be averaged
-- together. `business_costs` holds ONE number per cost line, forever, with no
-- date and no payer — it is a rate. An expense is an event: a date, an amount,
-- a vendor, a person who paid. Folding the second into the first would destroy
-- the projections (which need a stable rate) and could not represent a debt at
-- all. They stay apart and the report holds them side by side, which is the
-- whole point: seeing where the assumption was wrong.
--
-- WHY A LEDGER RATHER THAN A MONTHLY TOTALS TABLE
--
-- A monthly total cannot answer "who do we owe", cannot carry a receipt, and
-- cannot be corrected without rewriting history. The row-per-payment shape is
-- also what `stock_movements` (0056) settled on for the same reason — every
-- row is a human decision about real property and deserves a reason attached.

-- ─────────────────────────────────────────────────────────────────────────────
-- CATEGORIES
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `kind` is the load-bearing column here, not `name`. It is what lets the
-- profit report use these numbers at all:
--
--   variable  scales with books sold — printing, packing, courier. Compared
--             against the per-book assumptions in business_costs.
--   fixed     recurs whether or not a book sells — salary, servers, tools.
--             Compared against the monthly assumptions.
--   capital   a one-off asset — a printer. DELIBERATELY EXCLUDED from monthly
--             profit: a ₹60,000 printer bought once is not a ₹60,000 month,
--             and averaging it into a run rate would make one month look
--             catastrophic and every later month look better than it was.
--
-- The names are seeded but editable, because every shop discovers a category
-- it did not think of. `kind` is not free text for the same reason the tiers
-- above matter — a fourth kind would need the report to know what to do with
-- it, so adding one is a code change, not a data change.

CREATE TABLE IF NOT EXISTS expense_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('variable', 'fixed', 'capital')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One category per name. Two rows called "Printing" would split every total
-- silently, which is the failure mode nobody notices until the figures are
-- being argued over.
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_name_key
  ON expense_categories (lower(btrim(name)));

-- ─────────────────────────────────────────────────────────────────────────────
-- VENDORS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Who was paid. Optional on an expense — a UPI payment to a one-off shop does
-- not deserve a permanent record — but worth a table for the ones that recur,
-- because "how much have we paid this printer this year" is a real question
-- and free text cannot answer it. `print_runs.printer` is free text today and
-- is exactly that problem in miniature.

CREATE TABLE IF NOT EXISTS vendors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  default_category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  phone               TEXT,
  notes               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vendors_name_key
  ON vendors (lower(btrim(name)));

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNDERS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Who actually paid, out of whose pocket.
--
-- `is_company` is the entire reason this table exists rather than a text
-- column. Money the company spends on itself is a cost and nothing else. Money
-- Mubashir spends is a cost AND a debt the company owes him. Those two must
-- never be added together, and a boolean on the payer is the only place that
-- distinction can live without being restated at every call site.

CREATE TABLE IF NOT EXISTS funders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  -- TRUE for the business itself. Its spending never becomes a balance owed.
  is_company  BOOLEAN NOT NULL DEFAULT FALSE,
  phone       TEXT,
  upi_id      TEXT,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS funders_name_key
  ON funders (lower(btrim(name)));

-- ─────────────────────────────────────────────────────────────────────────────
-- THE LEDGER
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The day the money left, which is not the day somebody got round to typing
  -- it in. Every total on the report is grouped by this.
  spent_on      DATE NOT NULL,

  category_id   UUID NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  vendor_id     UUID REFERENCES vendors(id) ON DELETE SET NULL,
  -- RESTRICT, not SET NULL: an expense whose payer has been forgotten is an
  -- amount nobody can be repaid for. A funder with rows cannot be deleted.
  funder_id     UUID NOT NULL REFERENCES funders(id) ON DELETE RESTRICT,

  -- The print run this invoice paid for, where it paid for one.
  --
  -- `print_runs` (0056) already carries `copies` and `unit_cost_paise` — it is
  -- the only real supplier figure anywhere in this schema. A printing expense
  -- that ignored it would be a second, independently-editable record of the
  -- same purchase, and the two would disagree within a month. Linked instead,
  -- so the report can hold the assumed rate, the run's invoiced rate and the
  -- amount actually paid against each other.
  print_run_id  UUID REFERENCES print_runs(id) ON DELETE SET NULL,

  amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),

  -- Required, and that is the point — the same rule `stock_movements.reason`
  -- enforces. A ledger full of unexplained amounts is a ledger nobody trusts
  -- six months later, and this one is used to settle debts between people.
  description   TEXT NOT NULL CHECK (length(btrim(description)) > 0),

  -- Bill number, UPI reference, invoice id. Somebody else's identifier, so its
  -- shape is not this system's business.
  reference     TEXT,
  receipt_url   TEXT,

  -- How many books this covers, on a `variable` row. "This ₹40,000 printing
  -- bill covers 2,000 books" is what makes a real per-book cost derivable and
  -- comparable to the assumed one. Meaningless on fixed and capital rows.
  units         INT CHECK (units IS NULL OR units > 0),

  notes         TEXT,

  -- Both, like stock_movements: the id for joining, the email so the trail
  -- survives the staff row being deleted.
  actor_id      UUID REFERENCES staff(id) ON DELETE SET NULL,
  actor_email   TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The ledger is read newest-first and almost always inside a date range.
CREATE INDEX IF NOT EXISTS expenses_spent_on_idx ON expenses (spent_on DESC);
-- Balances group by payer; the report groups by category.
CREATE INDEX IF NOT EXISTS expenses_funder_idx   ON expenses (funder_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses (category_id, spent_on DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- REPAYMENTS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The company paying a funder back.
--
-- Mirrors `referral_payouts` (0008) column for column on purpose. That table
-- already solves this exact problem for referrers — including the comment on
-- `reference`: "UPI transaction reference, so a 'you never paid me'
-- conversation has an answer." This is the same conversation with a different
-- person and it should not get a second, differently-shaped answer.

CREATE TABLE IF NOT EXISTS funder_settlements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_id    UUID NOT NULL REFERENCES funders(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  method       TEXT,
  -- The transfer reference. See above.
  reference    TEXT,
  receipt_url  TEXT,
  note         TEXT,
  paid_by      UUID REFERENCES staff(id) ON DELETE SET NULL,
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS funder_settlements_funder_idx
  ON funder_settlements (funder_id, paid_at DESC);

-- A settlement to the company itself is not a transaction — it is money moving
-- from a pocket to the same pocket.
--
-- A trigger rather than a CHECK, because a CHECK constraint in Postgres cannot
-- contain a subquery and the rule depends on another table. Enforced in the
-- database at all rather than only in the route, because a balance that one
-- hand-written INSERT can corrupt is not a balance anybody should settle a
-- real debt against.
CREATE OR REPLACE FUNCTION funder_settlement_guard() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM funders f WHERE f.id = NEW.funder_id AND f.is_company) THEN
    RAISE EXCEPTION 'The company cannot repay itself — % is the company', NEW.funder_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS funder_settlement_guard_trg ON funder_settlements;
CREATE TRIGGER funder_settlement_guard_trg
  BEFORE INSERT OR UPDATE ON funder_settlements
  FOR EACH ROW EXECUTE FUNCTION funder_settlement_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THE COMPANY OWES
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Derived, never stored. A stored balance is a number that can disagree with
-- the rows underneath it, and the first time it does, every conversation about
-- who is owed what becomes unresolvable.
--
-- Company funders are included as rows so the screen can show what the
-- business itself has spent, but their balance is forced to zero: the company
-- does not owe itself money.

CREATE OR REPLACE VIEW funder_balances AS
SELECT
  f.id,
  f.name,
  f.is_company,
  f.is_active,
  f.sort_order,
  f.upi_id,
  COALESCE(e.funded_paise, 0)                        AS funded_paise,
  COALESCE(s.settled_paise, 0)                       AS settled_paise,
  CASE
    WHEN f.is_company THEN 0
    ELSE COALESCE(e.funded_paise, 0) - COALESCE(s.settled_paise, 0)
  END                                                AS balance_paise,
  COALESCE(e.expense_count, 0)                       AS expense_count,
  e.last_spent_on
FROM funders f
LEFT JOIN (
  SELECT funder_id,
         SUM(amount_paise)::BIGINT AS funded_paise,
         COUNT(*)::BIGINT          AS expense_count,
         MAX(spent_on)             AS last_spent_on
  FROM expenses GROUP BY funder_id
) e ON e.funder_id = f.id
LEFT JOIN (
  SELECT funder_id, SUM(amount_paise)::BIGINT AS settled_paise
  FROM funder_settlements GROUP BY funder_id
) s ON s.funder_id = f.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Written so a re-run changes nothing. Each row is inserted only if no row of
-- that name exists, so an edited name is never reverted and a deleted category
-- is never resurrected on the next apply.

INSERT INTO expense_categories (name, kind, sort_order)
SELECT v.name, v.kind, v.sort_order
FROM (VALUES
  ('Printing',              'variable', 10),
  ('Packing material',      'variable', 20),
  ('Courier & freight',     'variable', 30),
  ('Delivery agent payment','variable', 40),
  ('Salary',                'fixed',    50),
  ('Design & artwork',      'fixed',    60),
  ('Server & database',     'fixed',    70),
  ('Tools & subscriptions', 'fixed',    80),
  ('Printer & equipment',   'capital',  90),
  ('Other',                 'variable', 100)
) AS v(name, kind, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM expense_categories c
  WHERE lower(btrim(c.name)) = lower(btrim(v.name))
);

INSERT INTO funders (name, is_company, sort_order)
SELECT v.name, v.is_company, v.sort_order
FROM (VALUES
  ('Bisher',    TRUE,  10),
  ('Mubashir',  FALSE, 20),
  ('Nizam',     FALSE, 30)
) AS v(name, is_company, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM funders f WHERE lower(btrim(f.name)) = lower(btrim(v.name))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ACCESS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- RLS on, no policies: service-role only. The anon key ships in every browser,
-- and this is the table that says what the business spends and who it owes.

ALTER TABLE expense_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE funders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE funder_settlements  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  EXECUTE 'ALTER VIEW funder_balances SET (security_invoker = on)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported here; view stays owner-invoked';
END $$;

REVOKE ALL ON funder_balances FROM PUBLIC;
REVOKE ALL ON funder_balances FROM anon, authenticated;
GRANT SELECT ON funder_balances TO service_role;

REVOKE ALL ON FUNCTION funder_settlement_guard() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN expense_categories.kind IS
  'variable = scales with books, fixed = monthly, capital = one-off asset. '
  'Decides how lib/db/expenses.ts folds the row into profit; capital is '
  'excluded from any monthly figure.';

COMMENT ON COLUMN funders.is_company IS
  'TRUE for the business itself. Spending by a company funder is a cost but '
  'never a debt, and never appears in funder_balances.balance_paise.';

COMMENT ON COLUMN expenses.units IS
  'Books covered by this spend, on variable rows only. Lets a real per-book '
  'cost be derived and held against business_costs (0026).';

NOTIFY pgrst, 'reload schema';
