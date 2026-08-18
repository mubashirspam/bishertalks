# WhatsApp through Meta — getting a token that does not expire

Messages stopped because the access token expired. The log is unambiguous:

```
Invalid OAuth access token - Cannot parse access token
  — Access token expired or revoked, generate a new permanent system-user token
```

And the fallback is dead too — the Make.com webhook answers **410, "There is no
scenario listening for this webhook."** So both routes are down, which is why
nothing at all is arriving.

This fixes the Meta side properly, with a token that has no expiry.

---

## Why the old token died

Meta's app dashboard hands you a **temporary token that lasts 24 hours**. It is
right there on the API Setup page, it works immediately, and it is the one
almost everybody copies first. It is not meant for a running business.

The permanent one comes from a **System User** — a non-human account inside
Business Settings whose tokens can be set to never expire. Same permissions,
same API, no clock on it.

If your token came from the WhatsApp API Setup panel, that is the bug.

---

## The steps

### 1. Business Settings

<https://business.facebook.com/settings> → pick the business that owns the
WhatsApp number.

### 2. Create a System User

**Users → System users → Add**

- Name: anything — `bishertalks-api` is fine
- Role: **Admin**

Admin rather than Employee: an Employee system user cannot be granted full
control of a WhatsApp account, and the token it produces fails at send time
with a permissions error rather than at setup, which is a bad place to find out.

### 3. Give it the WhatsApp account

Still on the system user: **Add assets → WhatsApp accounts** → tick your WABA →
enable **Full control**.

Assign the **app** as well: **Add assets → Apps** → your app → **Full control**.

A token can only act on assets its system user holds. Skipping this is the
second most common cause of a token that authenticates but cannot send.

### 4. Generate the token

**Generate new token**, then:

- App: the one connected to your WhatsApp number
- **Token expiration: Never**
- Permissions, both of them:
  - `whatsapp_business_messaging` — sending
  - `whatsapp_business_management` — templates and numbers

Copy it now. **Meta shows it once.** Put it straight into `.env.local` as
`WHATSAPP_TOKEN`.

### 5. The phone number ID

**WhatsApp Manager → API Setup**. Copy **Phone number ID** — a long number, not
the phone number itself. That is `WHATSAPP_PHONE_NUMBER_ID`.

### 6. The app secret

**App Dashboard → Settings → Basic → App secret → Show**. That is
`WHATSAPP_APP_SECRET`, and it is what verifies that an incoming webhook really
came from Meta rather than from someone who guessed the URL.

### 7. The verify token

You invent this one. Any random string:

```
openssl rand -hex 16
```

Put it in `.env.local` as `WHATSAPP_VERIFY_TOKEN`, and paste the identical
string into Meta's webhook setup in the next step.

### 8. Point the webhook at us

**App Dashboard → WhatsApp → Configuration → Webhook → Edit**

- Callback URL: `https://<your-domain>/api/webhook/whatsapp`
- Verify token: the string from step 7

Then **Manage** the subscription fields and tick **messages**. Without that
subscription, delivery receipts never arrive and every message stays "sent"
forever, whatever really happened to it.

Meta calls the URL immediately to verify it, so the site must be deployed with
`WHATSAPP_VERIFY_TOKEN` already live. Localhost will not work.

---

## Check it

```
node scripts/check-env.mjs
```

It reports which pieces are missing. Then place a real order, or re-send a
notification from the order page, and watch `notification_log`.

---

## Templates

Meta only allows a **pre-approved template** for the first message to a customer
outside a 24-hour window — which is every message this shop sends. The wording
lives in `lib/whatsapp-templates.ts` and is submitted with:

```
npm run whatsapp:templates
```

A template that is drafted but not approved fails at send with a template error,
not a token error. If the token is fixed and messages still fail, check the
templates' status in WhatsApp Manager before anything else.

---

## About the fallback

`MAKE_WEBHOOK_URL` currently returns 410 — that scenario no longer exists. It is
worth either rebuilding it in Make or removing the variables, because right now
it reads like a working safety net and is not one. Once Meta has run clean for
a while, deleting it is the honest option.

---

## Things worth knowing

- **Never commit the token.** `.env.local` is gitignored; production needs the
  same variables set in the host's dashboard, not in a file.
- **A System User token still dies** if the system user is deleted, loses its
  asset assignments, or the app is put into development mode.
- **Pin the API version.** `WHATSAPP_API_VERSION` is set to `v21.0` on purpose;
  Meta ships breaking changes between versions and each is supported for about
  two years.
