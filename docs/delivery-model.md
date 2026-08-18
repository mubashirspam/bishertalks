# How delivery should work

Written after a session of confusion that was entirely self-inflicted: the
system asks you to make one decision twice, using two controls that mean the
same thing for the only courier you actually use.

## The confusion, precisely

There are two assignment columns, added two years apart:

| Column | Added | Asks |
|---|---|---|
| `assigned_agent_id` | 0019 | whose **portal** does this parcel appear on |
| `courier_id` | 0030 | who **carries** it |

For KKR they are the same answer. `kkrlogistic` is a staff login *and* KKR is
Delhivery's franchise, so "assign to kkrlogistic" and "set courier Delhivery"
are one decision wearing two hats. Nothing warns you; both controls sit on the
same bar; neither is obviously optional.

It got worse when 0033 split Delhivery across two courier rows to make the 167
missing parcels findable. That was a workaround for a missing state column, and
0035 removed the need for it — but by then the screen had three ways to say
"Delhivery" and none of them said it once.

## The corrected model

**One decision: which courier carries this parcel.** Everything else follows
from it.

```
                    ┌─ Delhivery ──────── we call their API. Waybill,
                    │                     scans and charges come back.
  order ─ courier ──┼─ Speed Post ─────── a person posts it. They type
                    │   / any other       the tracking number in.
                    │
                    └─ own rider ──────── a person delivers it. No
                                          tracking number exists.
```

An **agent** is only meaningful for a courier a person handles. A parcel going
to Delhivery does not need one — it goes into Delhivery's system, not onto
somebody's worklist. So the agent picker stops being required, and stops
appearing at all for an API courier.

Who *sees* a parcel in the portal is answered by the courier, not by an agent:
KKR's login sees Delhivery parcels because that is their courier.

## Two flows, kept apart

### 1. Delhivery — automatic

Assign → we check the pincode and mint a reference → **Send** → waybill comes
back → scans drive the status by themselves. Nobody types anything.

The portal shows what Delhivery gives us. Everything below is available today
from their API and is either already stored or one call away:

| | Where it comes from |
|---|---|
| Waybill | create / tracking |
| Current status + location + their wording | tracking |
| Full scan history, with times | tracking |
| Picked-up date | tracking |
| Promised & expected delivery date | tracking |
| Consignee as *they* hold it | tracking |
| Invoice amount, COD amount | tracking |
| Failed-attempt count | tracking |
| **Freight charge for the parcel** | invoice/charges API |
| **Packing slip** | packing-slip API |
| Serviceability, prepaid/COD, sorting centre | pincode API |

The last three are not wired up yet. The freight charge is the interesting
one — it is what Delhivery bills us per parcel, and it belongs in the profit
report next to printing and packaging.

### 2. Everything else — manual

Assign → hand it over or post it → type the tracking number in when there is
one. No API, no waybill, no scans. The screen must not ask for any of them,
and must not imply something is pending when nothing is.

## When Delhivery cannot deliver

The pincode check at assignment already answers this. What is missing is what
happens next:

1. The parcels are listed, not just counted — name, town, pincode.
2. One action moves them to another courier.
3. They stay visible as **Not serviceable** until somebody does.

Five orders are in this state now: 689662, 682551 (Androth, Lakshadweep),
685591 ×2, 676575.

## What must not change

- **No order or delivery data is deleted or overwritten.** Every step below is
  additive or a column write that can be reversed.
- `assigned_agent_id` **stays on the table** and keeps its values. It stops
  being *required*; it is not removed. 844 parcels carry it and that history is
  real.
- The 167 stay findable, the 617 keep their waybills, the references stay put.
