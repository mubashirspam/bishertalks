# Parcel reports — plan

A full reporting screen for parcels: how many are where, by courier, how long
they have been waiting, what shipped this year, and every one of those as a
filtered list you can download as Excel. Written before any code, so the
definitions below can be argued with first.

Status: **built.** Phases 0, 1 and 2 are in the code; the two migrations are
**not applied** — this repository never runs them automatically, so they wait in
[PENDING.md](../PENDING.md). Phase 3 is untouched and optional.

The plan below is kept as written, because the reasoning is what will be
argued with later. Where the build departed from it, §11 says so.

---

## 1. What is being asked for

Read back from the request, in the shop's own vocabulary:

| Ask | What it means here |
|---|---|
| Parcels by courier | Every paid parcel counted per courier (Delhivery API, KKR manual, Mubashir Logistic, Speed Post, and *no courier yet*), split by where it is. |
| Pending, ordered but not delivered, over 10 days / over 5 days, "I can control" | A **late** filter: not delivered, and more than *N* days old. *N* is typed or picked from chips, not fixed in code. |
| Shipped over this year | Shipped per month for a calendar year or an Indian financial year (Apr–Mar), plus a total. |
| Any kind of report, Excel download | Every list on the screen downloads as `.xlsx` or `.csv`, filtered exactly as shown. |
| "Assigned 1 parcel to Delhivery, filter assigned 24 August, get the list" | A date filter on **the day a courier was assigned**. This date is **not stored today** — see §3. |
| 10 days late | Same late filter with *N* = 10, and a "days late" column on every row. |
| Overall counts at top, all filters below | Summary tiles first, filter bar, breakdown tables, then the row list. |

## 2. Definitions the screen will use

These are the rules every number on the page follows. If two of them
disagree with what you expect, say so before Phase 1.

- **Parcel** — a paid order with a delivery address. Identical to the delivery
  queue's scope (`payment_status = 'paid' AND address_line1 IS NOT NULL`), so a
  number here can always be found there.
- **Where it is** — the seven `delivery_stage` values the queue already
  derives in the `portal_orders` view: new, assigned, shipped, out for
  delivery, delivered, returned, cancelled. No new stage vocabulary.
- **Ordered on** — `ordered_at` (the payment date), IST calendar day.
- **Assigned to courier on** — new column `courier_assigned_at` (§3), IST day.
- **Assigned to agent on** — `assigned_at`, already stored.
- **Shipped on / Delivered on** — `shipped_at` / `delivered_at`, IST day.
- **Days pending** — whole IST days from *ordered on* to now, for anything not
  delivered. For a delivered parcel the same column shows *days to deliver*
  (ordered → delivered).
- **Days in transit** — shipped → now, or shipped → delivered.
- **Late** — not delivered, not returned, not cancelled, and older than *N*
  days measured from a chosen **basis**: ordered (default), assigned to
  courier, or shipped. Default *N* = 10. Chips for 5, 10, 15; a number box for
  anything else.
- **This year** — two presets: calendar (1 Jan–31 Dec) and financial (1 Apr–31
  Mar). Both are just `from`/`to` values, so any other range works too.
- **All dates are IST.** Every filter converts with the existing
  `istDayStartUTC` / `istDayEndUTC` helpers, the same way the orders and
  delivery screens do.

## 3. The data gap: when was a courier assigned?

Routing a parcel (`POST /api/admin/delivery/courier`) writes `courier_id` and
clears `courier_send_error`. It does **not** write a timestamp. The only
record of the moment is the audit row `order.courier_assigned` in `audit_log`,
keyed by order number.

`courier_entered_at` and `courier_sent_at` are *not* substitutes: the first is
"keyed into the courier's system", the second is "their API accepted it", and
for a manual courier both can be days after the routing decision, or never.

So Phase 0 adds the column and back-fills it. Without it the "assigned on
24 August" filter cannot exist.

**Migration `0057_courier_assigned_at.sql`:**

1. `ALTER TABLE orders ADD COLUMN courier_assigned_at TIMESTAMPTZ;`
   and `courier_assigned_by UUID REFERENCES staff(id) ON DELETE SET NULL`
   (mirrors `assigned_at` / `assigned_by` for agents).
2. Back-fill, in this order of preference, only where `courier_id IS NOT NULL`:
   1. the latest `audit_log` row with `action = 'order.courier_assigned'`,
      `entity_id = order_number` and `meta->>'courier_id'` equal to the current
      `courier_id` — the real moment;
   2. else `courier_entered_at`;
   3. else `courier_sent_at`;
   4. else `assigned_at` (agent), else `shipped_at`, else `ordered_at`.
   Rows filled from steps 2–4 are approximations and the migration logs how
   many were filled from each source, so the number is known.
3. Rebuild `portal_orders` copying the definition from **0055** (the latest
   that creates it), because the view is `SELECT o.*` and cannot pick up a new
   column otherwise. Same rule the 0045 comments insist on.
4. Index: `(courier_assigned_at DESC) WHERE payment_status = 'paid' AND address_line1 IS NOT NULL`.

**Code change:** the routing route sets `courier_assigned_at = NOW()` and
`courier_assigned_by = actor` when `courier_id` is set, and nulls both when it
is cleared. Add both fields to `lib/types/order.ts` and `DeliveryRow`.

## 4. Where it lives

- Route: `/admin/analytics`. Nav label **Reports**, icon `BarChart3`, placed
  between *Insights* and *Profit & targets*. The existing `/admin/reports`
  keeps its URL and its "Profit & targets" label.
- Permission: **`delivery.view`** to open the page (it is operational, and
  the row list shows names and phones the delivery screen already shows), and
  **`orders.export`** for the download buttons, matching every other export.
  A separate `analytics.view` permission is possible but adds a checkbox to
  the staff form for no current need.

## 5. The screen, top to bottom

```
┌ Reports ─────────────────────────────────────────────────────────────────┐
│ [Count by: Ordered ▾] [From] [To] [Today 7d 30d This month This year FY] │
│ [Courier ▾] [Agent ▾] [Where: chips new/assigned/shipped/…] [State ▾]    │
│ [Late: more than (10) days since Ordered ▾] [5][10][15]  [Search…] Clear │
├──────────────────────────────────────────────────────────────────────────┤
│  1,412      118        64          1,180      31        19       46      │
│  Parcels    Not yet    In transit  Delivered  Returned  Cancelled Late    │
│             shipped                 84%       avg 6.2d            >10d   │
├──────────────────────────────────────────────────────────────────────────┤
│ Waiting for how long (undelivered only)                                  │
│  0–2d ███ 41   3–5d ██ 29   6–10d ██ 24   11–15d █ 12   16d+ █ 34       │
├──────────────────────────────────────────────────────────────────────────┤
│ By courier                                                               │
│ Courier      Total  Not shipped  Transit  Delivered  Returned  Late  Avg │
│ Delhivery      812        12        40        740        14      9   5.1 │
│ KKR manual     390        60        20        300         8     22   7.9 │
│ Speed Post      95        30         4         58         3     11   9.4 │
│ No courier      115       115         –          –         –      4    – │
├──────────────────────────────────────────────────────────────────────────┤
│ Shipped & delivered by month (2026)         [bar chart, 12 months]       │
├──────────────────────────────────────────────────────────────────────────┤
│ By agent  (Holding / Shipped / Delivered / Late)                         │
├──────────────────────────────────────────────────────────────────────────┤
│ 1,412 parcels                                    [Download Excel ▾ CSV]  │
│ Order#  Ordered  Assigned  Shipped  Delivered  Courier  Where  Days  … │
│ … 50 per page …                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Behaviour that matters:

- **Every filter is a URL parameter.** Bookmarkable, shareable, and the
  download sends the same query string, so the file always equals the screen
  (the `ContactDownload` pattern).
- **Every number is a link.** A cell in the courier table sets `courier=` and
  `stage=` on the list below; an ageing bucket sets `age_min`/`age_max`; a
  month bar sets `from`/`to`. The count you click is the list you get.
- **"Count by" chooses the date column** the range applies to: ordered
  (default), assigned to courier, assigned to agent, shipped, delivered. This
  is what makes "assigned on 24 August" a two-click question: *Count by:
  Assigned to courier*, *From/To: 24 Aug*.
- The summary tiles, courier table, ageing buckets and monthly chart all
  respect every filter **except** the stage chips and the late filter, the
  same reasoning as the delivery stats strip: a breakdown narrowed to one of
  its own rows is a mirror, not a fact. The row list respects everything.
- Stage tabs on the delivery screen are single-select; here **stage is
  multi-select** (e.g. shipped + out for delivery = "in transit"), encoded as
  `stage=shipped,out_for_delivery`.

## 6. Filters, exactly

| Param | Values | Applies to |
|---|---|---|
| `by` | `ordered` (default), `courier_assigned`, `agent_assigned`, `shipped`, `delivered` | which date `from`/`to` test |
| `from`, `to` | IST `YYYY-MM-DD`, inclusive | date range |
| `courier` | courier id, `none`, or empty | courier |
| `agent` | staff id, `none`, or empty | delivery agent |
| `stage` | comma list of `delivery_stage` values | where it is (list only) |
| `handover` | one `handover_state` | what is happening to it |
| `late` | integer days, `0`/empty = off | the late filter (list + late tile) |
| `late_from` | `ordered` (default), `courier_assigned`, `shipped` | late basis |
| `age_min`, `age_max` | integer days since ordered, undelivered only | ageing bucket drill-down |
| `books`, `gift`, `signed` | as on the delivery screen | packing filters |
| `q` | text | order #, name, phone, pincode, waybill |
| `state` | Indian state name | address state (Phase 2) |
| `sort` | `oldest`, `newest`, `age` | list order |
| `page` | 1-based | list paging |

Presets shown as chips are only pre-filled combinations of the above:
*Late > 10 days*, *Assigned yesterday*, *Shipped this month*, *Undelivered by
courier*, *Shipped this financial year*.

## 7. How it is computed

Same shape as migration 0045, for the same reason: the filters are written
**once, in SQL**, and every number, every row and every export reads through
that one function, so a count can never disagree with its list.

**`report_scope(p_by, p_from, p_to, p_courier, p_agent, p_stages TEXT[], p_handover, p_late INT, p_late_from, p_age_min, p_age_max, p_books, p_gift, p_signed, p_q, p_state)`**
returns a table of the columns the page and the export need (order number,
buyer, phone, pincode, city, state, amount, quantity, courier id, stage,
handover state, the six timestamps, waybill, courier reference, postal
barcode, and three computed columns: `days_pending`, `days_in_transit`,
`is_late`). Reads `portal_orders`. Named columns, not `SETOF portal_orders`,
for the dependency reason 0045 explains.

**`report_summary(...)` → JSONB**, same parameters minus `p_stages`, `p_late`
(the late count is computed for the *given* threshold but the list-only
filters are not applied), containing:
- `totals` per stage, plus `late`, `delivery_rate`, `avg_days_to_deliver`,
  `median_days_to_deliver`;
- `ageing` buckets `0-2, 3-5, 6-10, 11-15, 16+` over undelivered parcels;
- `couriers[]` — per courier id (and `none`): total, not shipped, in transit,
  delivered, returned, cancelled, late, avg days to deliver;
- `agents[]` — per agent id: holding, shipped, delivered, late;
- `months[]` — shipped and delivered per IST month across the range (or per
  day when the range is ≤ 31 days);
- `states[]` — top 10 address states by parcels and delivery rate (Phase 2).

**The list** pages the same function through PostgREST:
`supabaseAdmin.rpc("report_scope", args).range(from, to)` with
`{ count: "exact" }`. No TypeScript query builder to keep in step.

**The export** reads `report_scope` through `fetchAllRows` (1,000 per page,
50,000 ceiling, `truncated` warning), like the orders export.

Performance: ~1,400 parcels today. Every aggregate is one round trip. The
partial indexes already on the shippable scope cover `ordered_at`; Phase 0
adds one for `courier_assigned_at`. `shipped_at`/`delivered_at` get partial
indexes in the same migration since the monthly chart groups on them.

## 8. Files

Phase 0
- `supabase/migrations/0057_courier_assigned_at.sql` — column, back-fill, view rebuild, indexes.
- `app/api/admin/delivery/courier/route.ts` — write the timestamp.
- `lib/types/order.ts`, `lib/db/delivery-query.ts` — the two new fields.
- `app/admin/(protected)/delivery/DeliveryTable.tsx` — show "assigned 24 Aug" under the courier name (small, but it is where the fact becomes visible).

Phase 1
- `supabase/migrations/0058_parcel_reports.sql` — `report_scope`, `report_summary`, grants.
- `lib/report-filters.ts` — the filter type, `parseReportFilters`, `reportArgs`, presets, labels. Browser-safe (no Supabase import), like `lib/delivery-stage.ts`.
- `lib/db/parcel-report.ts` — `reportSummary`, `fetchReportPage`, `fetchReportRows` (export).
- `app/admin/(protected)/analytics/page.tsx` — server page, three Suspense boundaries (summary, breakdowns, list).
- `app/admin/(protected)/analytics/ReportFilters.tsx` — client filter bar.
- `app/admin/(protected)/analytics/SummaryTiles.tsx`, `CourierTable.tsx`, `ReportTable.tsx`, `loading.tsx`.
- `app/admin/(protected)/analytics/ReportDownload.tsx` — Excel / CSV buttons sending the current query string.
- `app/api/admin/reports/parcels/route.ts` — the export; `xlsx` builds a two-tab workbook (*Parcels* + *Summary*) with `toXLSXWorkbook`, `csv` the rows only.
- `lib/admin-nav.ts` — the nav item.
- `lib/permissions.ts` — no change (see §4).

Phase 2
- `AgeingBuckets.tsx`, `MonthlyChart.tsx` (hand-rolled bars, no chart library — matches `RevenueCharts`), `AgentTable.tsx`, `StateTable.tsx`.
- Dashboard `CourierStatusTable` cells gain a second link into the report list.
- Order detail page shows *Assigned to courier on* in its timeline.

## 9. Phases and effort

| Phase | Delivers | Size |
|---|---|---|
| **0 — the date** | `courier_assigned_at` stored, back-filled, shown | migration + 4 small edits |
| **1 — the report** | page, filters, tiles, courier table, row list, Excel/CSV, nav | the bulk: 2 SQL functions, ~8 files |
| **2 — the breakdowns** | ageing buckets, monthly/yearly chart, agent table, state table, drill-down links, presets | ~5 components, SQL additions |
| **3 — polish** | saved filter presets in the UI, "days to deliver" percentiles, dashboard "late" tile linking here | optional |

Phase 0 must ship and the migration must be **applied by hand** (migrations
here are never automatic) before Phase 1's "assigned on" filter shows anything
but the back-fill.

## 10. Decisions taken, and what to say if they are wrong

1. **Parcels only** — unpaid orders and paid orders without an address are
   excluded, as on the delivery screen. If the report should also count the
   funnel, that is the orders screen's export, not this one.
2. **Late excludes cancelled and returned.** A returned parcel is not "still
   pending"; it has its own column.
3. **Default late threshold is 10 days from ordered.** Changeable per view;
   not stored as a setting. If a stored default is wanted it goes in
   `checkout_settings`-style config later.
4. **Days are whole IST days**, floor, so a parcel ordered at 11pm and looked
   at 9am next day is 1 day old, not 0.
5. **Permission is `delivery.view`**, not `reports.view` — `reports.view` is
   documented as the margin-structure trust and this page shows no money
   beyond order value.
6. **Back-fill approximations are labelled.** A row whose
   `courier_assigned_at` came from `courier_entered_at` or later is still
   right to the day in practice, but the migration prints the counts so the
   uncertainty is on record.
7. **No chart library.** Bars are divs with pixel heights, like every other
   chart in the admin.


---

## 11. What was built, and where it departed from the plan

Everything in phases 0, 1 and 2 shipped. Three things came out differently, all
of them decided while writing the code.

**The scope function gained an `only_late` switch, separate from the
threshold.** The plan treated "late" as one filter. It is two: the threshold
computes an `is_late` flag on *every* row, and a separate switch decides
whether to show only those rows. Without the split the table could not put a
late badge on a list that also contains parcels which are fine, and the Late
tile could not count late parcels within an unfiltered whole.

**Return columns are explicitly cast.** `orders` predates this migration folder
— it was created in the Supabase console — so nothing in the repository states
whether `order_number` is TEXT or VARCHAR, or `amount_paise` INTEGER or BIGINT.
A SQL function whose body returns VARCHAR where its signature says TEXT fails at
call time with a confusing error a long way from its cause, so every column in
`report_scope` is cast to its declared type.

**Cancelled parcels are excluded from the ageing drill-down.** The plan
excluded delivered and returned. It missed cancelled, whose `days_pending`
climbs forever — so a cancelled parcel lands in the oldest bucket and would
have swamped exactly the list most worth reading. The bar and the list behind
it now exclude the same three.

### Not done

Phase 3 in full: saved filter presets stored per user, delivery-time
percentiles beyond the median, and a "late" tile on the dashboard linking here.
The six saved views in `lib/report-filters.ts` are hard-coded rather than
user-editable, which covers the common case without a settings table.

### Verified, and not

`tsc` passes, `next build` compiles, `eslint` is clean on every new file, and
`/admin/analytics` is registered as a dynamic route. **The SQL has not been
executed** — there is no local Postgres or Docker on this machine, and running
it against the live database is not something to do unasked. Both migrations
are therefore syntactically reviewed but unproven, and the first apply should
be watched.
