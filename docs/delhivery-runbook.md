# Delhivery — runbook

What to do when something goes wrong, and how to turn the thing on in the first
place. The design is in `delhivery-integration-plan.md`; this is the operational
half.

---

## Turning it on

Nothing sends until all of this is done. Until then the shop behaves exactly as
it did before: assign a courier, hand the parcel over, type the tracking number
in.

1. Apply the migrations — `0028`–`0031` are in. **`0032` is new** and is what
   puts live tracking on the parcels that went out on the Excel sheet.
2. **`DELHIVERY_ENV=production` in `.env.local`.** Our token is a production
   token; against staging every call returns 401 "Login or API Key Required".
   This is safe on its own — the Send button is still off at step 5.
3. **Check it** — `node scripts/check-env.mjs`.
4. **Set the pickup location** on the Delhivery courier at `/admin/couriers`,
   spelled exactly as Delhivery has it registered. Confirm the spelling with
   them first; a mismatch rejects the whole payload, not one parcel.
5. **Prove it works.** With no staging access, `--manifest` creates a *real*
   parcel — so read the response, then cancel it immediately.
   ```
   node scripts/delhivery-smoke.mjs --serviceability 673001   # read-only, start here
   node scripts/delhivery-smoke.mjs --manifest --yes-create-real-shipment
   node scripts/delhivery-smoke.mjs --track <waybill>
   node scripts/delhivery-smoke.mjs --cancel <waybill>        # do not skip
   ```
6. **Turn the Send button on.** `INTEGRATED_SLUGS` in `lib/couriers/types.ts`
   is empty on purpose. Add `"delhivery"` once step 5 has produced a waybill.

> Step 6 is not an oversight. A rejected batch with a hundred parcels selected
> is a bad way to discover the pickup location is wrong by one character.

---

## Everyday operation

### The two screens

**`/admin/delivery`** is where a parcel is *routed*: tick rows, pick an agent,
pick a courier. Three buttons, and they do different amounts of damage:

| Button | What it does | Reversible? |
|---|---|---|
| Set courier | Writes which courier carries it. Tells nobody. | Freely |
| Sync status | Asks the courier where these are. Changes nothing at their end. | N/A — read only |
| Send | Hands the parcels to the courier's API. | Only by cancelling with them |

**`/admin/delivery-portal`** is where a parcel is *worked*, and it now has a
courier picker at the top that changes what the screen is:

- **A courier with live tracking** (Delhivery, either row) — the grid shows the
  waybill and the courier's own latest scan, with a **Sync now** button. No
  spreadsheet, no copying addresses. A parcel showing **"Not with them"** has no
  record at the courier at all, which almost always means a sheet that was
  downloaded but never uploaded.
- **Anyone else** — exactly the screen it has always been: tick parcels, download
  the Excel sheet, enter tracking numbers by hand.

### Tracking and sending are separate capabilities

A courier can report scans without accepting sends, and that is not an edge
case — it is our main one. Everything KKR uploaded by hand left on a
spreadsheet, yet Delhivery knows all of it and will report every scan. So
`handoff` says how a parcel *leaves*, and `config.tracking` says whose API can
say where it *is*. Migration 0032 sets the second on both Delhivery rows.

**Assigning is not sending.** On `/admin/delivery`, "Set courier" writes which
courier carries a parcel and does nothing else. "Send" is the button that hands
them over, and it asks first, because the undo is a cancellation with Delhivery
rather than a click here.

**A parcel with no integration** — Speed Post, a rider, anything `manual` — is
assigned the same way and then handed over by a person. The tracking number goes
in on the order page or in the portal's Shipped box.

**Statuses come back on their own** once the push webhook is live, and via
`/api/cron/courier-poll` in the meantime. The full lifecycle is mapped:

| Delhivery says | The order becomes | Customer hears |
|---|---|---|
| Manifested / Not Picked | Packed | — |
| Picked up / In Transit | Shipped | WhatsApp |
| Dispatched | Out for delivery | — |
| Delivered | Delivered | WhatsApp |
| RTO (in transit) | *unchanged* | — |
| RTO Delivered | Returned | — |

Two rules protect this. Scans only move an order **forwards**, so a replayed or
late-arriving scan cannot un-deliver a parcel. And an RTO scan does nothing
until the return has actually reached us — a parcel in a Delhivery van on its
way back is not yet returned, and marking it so would void the referral
commission early.

Anything unrecognised — lost, on hold, a failed attempt — records the scan text
and leaves the status alone for a person to judge.

---

## When something goes wrong

### "Delhivery is not set up yet" with a list

Exactly what it says — one of the Phase 0 values is missing. The list names the
thing to go and ask for. Nothing was claimed or sent.

### A parcel shows a red error on the delivery list

Read it. Three kinds:

| The error says | What happened | What to do |
|---|---|---|
| A specific refusal from Delhivery | They rejected that parcel | Fix the address / whatever they named, and send again |
| "Delhivery doesn't deliver to ______" | Pincode not serviceable | Use a different courier for this one |
| "…check Delhivery before sending again; it may already be there" | **We never found out** | See below — do not just retry |

### The dangerous one: "it may already be there"

This appears when a send timed out or their gateway failed mid-call. The
shipment may or may not exist on their side, so the parcel is deliberately left
**held** — it cannot be sent again by accident.

1. Look the order number up in Delhivery's dashboard.
2. **If it is there**: put the waybill into the order's Tracking Number field.
   The parcel is fine.
3. **If it is not there**: clear the hold so it can be sent again —
   ```sql
   UPDATE orders SET courier_sent_at = NULL, courier_send_error = NULL
   WHERE order_number = 'ORD-XXXXXX';
   ```

Never skip step 1. Clearing the hold on a parcel that *was* created is how one
order becomes two parcels, two waybills and one book.

### A parcel needs to go back

Use Cancel on the order page. It calls Delhivery first and only changes our
records if they agree. If they refuse, their reason is shown — usually the
parcel is already out for delivery, in which case it cannot be recalled and it
will come back as an RTO.

Note their quirk: a cancelled **prepaid** shipment becomes `Returned` on their
side, not `Cancelled`. The RTO scans that follow are expected.

### Catching up the back catalogue

Parcels that went out on the Excel sheet have a Reference No but no waybill.
`scripts/delhivery-backfill.mjs` looks every one of them up, stores the waybill
and syncs the status:

```
node scripts/delhivery-backfill.mjs            # dry run — shows what it would do
node scripts/delhivery-backfill.mjs --write    # save
```

It sends **no customer messages** — learning that a parcel shipped last week is
not news anyone is waiting for, and several hundred at once would get the
number reported. It *does* settle referral commissions, through the same RPCs
the admin uses, so nobody is underpaid.

Afterwards the poller and the Sync now button keep everything current, and those
*do* message customers, because by then a scan is a real event.

### Statuses have stopped updating

- Is the webhook live? Delhivery enables it at their end; ask them.
- Is `DELHIVERY_WEBHOOK_SECRET` set, and does it match what they were given?
  A mismatch shows as `[Delhivery] webhook rejected` in the logs.
- Is the poller running? It needs `CRON_SECRET` and a scheduler calling
  `GET /api/cron/courier-poll` with `Authorization: Bearer $CRON_SECRET`.
  **There is no scheduler configured in this repo** — that is a deployment
  setting, not code.

### Everything is refused at once

Almost always the pickup location. Delhivery rejects an entire payload if the
name does not match a warehouse they have registered — check it on
`/admin/couriers` against what they told you, character for character.

---

## If Delhivery is down

Switch the Delhivery courier off at `/admin/couriers` and assign the day's
parcels to **Delhivery — Excel sheet** instead. That is the old flow, unchanged:
the portal downloads the `.xlsx` and someone uploads it. Nothing else in the
system cares which of the two carried a parcel.

---

## Things that are true and easy to forget

- **The waybill lives in `tracking_number`**, the same column the customer's
  tracking page reads and the "shipped" WhatsApp quotes. There is no second one.
- **A successful send sets `courier_entered_at`**, exactly as downloading a
  sheet does, so the portal's New/Confirmed filters work for both.
- **A scan never writes `orders.status` directly** — it goes through
  `setDeliveryStatus`, so delivery settles the referral commission and a return
  voids it. Anything that bypasses that pays the wrong people.
- **Delhivery does not sign their webhooks.** The shared secret is the only
  protection on that endpoint. Treat it like a password.
- **Staging and production take different tokens.** A 401 saying "Login or API
  Key Required" almost always means the token and `DELHIVERY_ENV` disagree.
- **Manifesting does not summon a van.** `lib/delhivery/pickup.ts` books a
  collection (`POST /fm/request/new/`) where there is no standing arrangement.
