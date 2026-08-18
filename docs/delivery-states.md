# Every state a parcel can be in

The delivery flow now has three ways a parcel can leave (an API, a spreadsheet,
a person carrying it) and two ways we learn where it is (the courier tells us,
or someone types it in). That is enough combinations that "what is happening to
this order" stops being answerable from `status` alone.

So there is one derived value, **handover state**, that answers it — computed
from columns, never stored, so it cannot drift out of step with them. Every
scenario below is one value of it, every one is filterable, and no parcel can
fall outside the list.

---

## The columns it is derived from

| Column | Means | Set by |
|---|---|---|
| `courier_id` | who is meant to carry it | assigning on /admin/delivery |
| `pincode_serviceable` | can that courier reach the address | serviceability check at assign time |
| `courier_reference` | the number the courier files it under | **assignment** (was: sheet download) |
| `courier_entered_at` | we consider it handed over | sheet download, API send, or a tick |
| `courier_sent_at` | *our* API call succeeded | send route only |
| `courier_send_error` | last refusal, or "outcome unknown" | send route |
| `tracking_number` | the courier's waybill — proof they have it | API send, or a lookup, or typed in |
| `courier_checked_at` | when we last asked the courier about it | sync / poller |
| `courier_last_scan` | their own words | sync / poller |
| `status` | fulfilment stage the customer sees | scans, or a manual tick |

The distinction that matters most: **`courier_entered_at` is what we believe,
`tracking_number` is what the courier confirms.** Every bad state below is a
disagreement between those two.

---

## The states

### Before it is anyone's

| State | How it is detected | What to do |
|---|---|---|
| **Not routed** | no `courier_id` | choose a courier |
| **Checking serviceability** | routed, `pincode_serviceable` is null | wait, or re-check |
| **Not serviceable** | `pincode_serviceable` false | route to a partner that covers it |

### Routed, not yet gone

| State | How it is detected | What to do |
|---|---|---|
| **Ready to send** | API courier, reference set, no waybill, no `courier_entered_at` | press Send |
| **Ready for a sheet** | sheet courier, reference set, no `courier_entered_at` | download the sheet |
| **Send failed** | `courier_send_error`, no waybill, `courier_sent_at` null | fix what they named, send again |
| **Held — outcome unknown** | `courier_send_error`, `courier_sent_at` set, no waybill | check their dashboard **before** retrying |

### Handed over

| State | How it is detected | What to do |
|---|---|---|
| **On a sheet, unconfirmed** | reference + `courier_entered_at`, no waybill, never checked | sync to find out |
| **Not received** | same, but `courier_checked_at` set and still no waybill | chase — the courier does not have it |
| **With the courier** | `tracking_number` present | nothing; scans drive it from here |
| **Handed over (manual)** | manual courier, `courier_entered_at`, no waybill | type the tracking number in when you have it |

### With the courier — from their scans

`status` carries these, and only a scan or a deliberate tick moves them.

Packed · Shipped · Out for delivery · Delivered · Returned

| State | How it is detected | What to do |
|---|---|---|
| **Needs attention** | scan is a failed attempt, on-hold, lost or NDR | ring the customer or the courier |

### Legacy

| State | How it is detected | What to do |
|---|---|---|
| **Legacy — no reference** | shipped before references existed; no `courier_reference` | try the alternate keys below |
| **Ambiguous match** | an alternate key matched but the shipment did not corroborate | a human decides; never matched automatically |

---

## Matching old orders

Orders placed before migration 0024 have no `courier_reference`, but they are in
the courier's system under *something*. Known patterns, in the order they are
tried:

1. `BISH` + last 5 digits of mobile — the current scheme
2. `BISH` + last 6, then the whole mobile — the collision fallbacks
3. `BISH` + last 4 digits of mobile — older scheme
4. `BISH` + pincode — older scheme
5. the bare order number

**A speculative match is never accepted on the reference alone.** Four digits of
a mobile collide often, and a pincode collides constantly — hundreds of our
parcels go to 673001. So a candidate match must also agree on **invoice amount
and destination pincode** before the waybill is written. Anything that matches
the key but disagrees on the details becomes **Ambiguous match** and waits for a
person. Guessing here would attach one customer's waybill to another's order.

---

## Rules that must not be broken

1. **A parcel with a waybill is never sent again**, whatever `courier_sent_at`
   says. The waybill is proof the courier has it; `courier_sent_at` only knows
   about calls we made.
2. **An unknown send outcome keeps the parcel held.** Releasing it is the
   convenient choice and the one that produces two parcels for one order.
3. **A scan only moves an order forwards**, because scans replay and arrive out
   of order.
4. **A manual status change is respected** — the next sync will not silently
   overwrite it with an older scan, only with a newer one.
5. **Serviceability is re-checked when the courier changes**, because the answer
   is a property of the pair, not of the address.
6. **Nothing is ever deleted to fix a state.** Every transition above is a
   column write that can be reversed.
