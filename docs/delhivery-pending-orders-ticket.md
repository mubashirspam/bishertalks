# Support ticket — pushing orders as *pending* instead of manifested

Draft to send to Delhivery support (and/or the account/onboarding manager for
KKR LOGISTICS FRANCHISE). Fill in the bracketed placeholders before sending.

**Fill in first:**

- `[CLIENT NAME]` — our registered client name on the account
- `[ACCOUNT / CLIENT ID]` — as it appears in the portal
- `[REGISTERED EMAIL]` — the email the account is registered under
- `[YOUR NAME]` / `[PHONE]` — signature

**Do not paste the API token.** It is redacted in the appendix below and must
stay that way — a token in a support thread is a token in someone's inbox.

---

## Subject

API to create orders in *pending / unmanifested* state — [CLIENT NAME],
pickup location KKR LOGISTICS FRANCHISE

---

## Body

Hello Delhivery team,

We are integrated with your API and pushing orders successfully. We would like
to change **how** the orders arrive at your end, and we cannot find the right
endpoint in the documentation — hence this ticket.

**Account details**

- Client name: [CLIENT NAME]
- Account / client ID: [ACCOUNT / CLIENT ID]
- Registered email: [REGISTERED EMAIL]
- Pickup location: `KKR LOGISTICS FRANCHISE`
- Environment: production (`https://track.delhivery.com`), staging also
  configured (`https://staging-express.delhivery.com`)

**What we do today**

We call `POST /api/cmu/create.json`. It works — the shipment is created and a
waybill comes back in the same response. The exact request we send is in the
appendix at the end of this email.

**What we need instead**

We want the order to arrive in the Delhivery portal as a **pending order that
has not yet been manifested** — no waybill assigned at the point we push it.
The franchise team (KKR LOGISTICS FRANCHISE) would then review those pending
orders in the portal, manifest them themselves, and move them to
packed/approved as part of their normal workflow.

In other words: we want to supply the order data, and leave the manifestation
as a human step at your end rather than something our API call performs.

The reason is operational. Because `create.json` manifests immediately, an
order becomes a live shipment the instant our system pushes it, before the
parcel has been physically checked and packed. We would rather the franchise
confirm each one.

**Questions**

1. Is there an API endpoint that creates an order in a **pending /
   unmanifested / draft** state, without assigning a waybill? If so, please
   send the endpoint, method, headers and a complete sample payload.

2. If there is no separate endpoint — is there a **parameter or flag** on
   `/api/cmu/create.json` that produces this behaviour (for example a status
   field, a "soft data upload" mode, or an order-only push)?

3. If neither exists, is this behaviour available through a different product
   — a seller-panel order import, an OMS integration, or a bulk order upload
   API that is distinct from manifestation?

4. Once such an order is pending, **what does the franchise user do in the
   portal to manifest it**, and at what point is the waybill assigned?

5. After the franchise manifests it, **how do we learn the waybill?** We match
   shipments using the `order` field we send, which comes back to us as
   `ReferenceNo` in the tracking API and in the status webhook. Will that
   still hold for an order manifested manually in the portal?

6. Should orders like these be pushed under **our account** or under the
   **franchise's account**? Today they land under the pickup location
   `KKR LOGISTICS FRANCHISE`.

7. What are the **rate limits** on whichever endpoint you recommend?

If a call is easier than email, we are happy to get on one — please suggest a
time.

Thank you,

[YOUR NAME]
[CLIENT NAME]
[PHONE] · [REGISTERED EMAIL]

---

## Appendix — the request we currently send

### Endpoint

```
POST https://track.delhivery.com/api/cmu/create.json
```

Staging: `https://staging-express.delhivery.com/api/cmu/create.json`

### Headers

```
Authorization: Token <REDACTED>
Accept: application/json
Content-Type: application/json
```

### Body

Sent as a form-shaped string with a `Content-Type` of `application/json`, which
is what your Postman collection does. The JSON is **not** URL-encoded:

```
format=json&data={ ...the JSON below... }
```

### Payload

One shipment per call. Customer details below are a sample, not a real
customer's:

```json
{
  "shipments": [
    {
      "name": "SAMPLE CUSTOMER",
      "add": "House name, Near landmark, Town, District, 9XXXXXXXXX",
      "pin": "673001",
      "city": "Kozhikode",
      "state": "Kerala",
      "country": "India",
      "phone": "9XXXXXXXXX",

      "order": "ORD-XXXXXX",
      "waybill": "",

      "payment_mode": "Prepaid",
      "total_amount": 699,
      "cod_amount": 0,

      "products_desc": "BOOK",
      "quantity": 1,
      "weight": 250,
      "shipment_length": 10,
      "shipment_width": 10,
      "shipment_height": 10,
      "fragile_shipment": "true",
      "shipping_mode": "surface",

      "seller_name": "BISHER",
      "seller_add": "KOZHIKODE-6282680794",
      "return_add": "GROUND FLOOR, 63/2069/C2, HI DAWN TOWER, KUNIYIL KAVU ROAD, KOZHIKODE",
      "return_pin": "673001",
      "return_name": "BISHER",

      "client": "[CLIENT NAME]"
    }
  ],
  "pickup_location": {
    "name": "KKR LOGISTICS FRANCHISE",
    "city": "[PICKUP CITY]",
    "pin": "[PICKUP PIN]",
    "phone": "[PICKUP PHONE]",
    "add": "[PICKUP ADDRESS]",
    "country": "India"
  }
}
```

### Notes on the fields

- `order` is our own order number and is unique. We rely on it coming back as
  `ReferenceNo` from `GET /api/v1/packages/json/?ref_ids=…` and from the status
  webhook — that is how a scan is matched to an order at our end.
- `waybill` is sent empty so that Delhivery assigns one. We do not
  pre-allocate waybills.
- Every order is **prepaid** before it reaches this stage, so `cod_amount` is
  always `0`.
- `weight` is 250g per book, multiplied by the number of copies.
- e-waybill fields (`seller_gst_tin`, `hsn_code`) are only sent when a single
  shipment is worth ₹50,000 or more, which for a book order never happens.

### One related issue, in case it is relevant

`GET /api/v1/packages/json/` with `ref_ids` refuses the **whole query** with
`{"Error": "No such waybill or Order Id found"}` when any single id in the list
is unknown, rather than omitting that one entry. We work around it by falling
back to one id per request. If there is a way to get per-id results from a
batched query, we would like to know.
