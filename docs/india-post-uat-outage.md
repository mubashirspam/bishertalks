# India Post UAT is not answering — evidence, and the email to send

**Measured 2026-08-27, after `103.180.89.153` was added to the UAT whitelist.**

The whitelist entry is confirmed present in the portal and matches this
machine's current public address. The sandbox behaves **byte for byte
identically before and after** it was added. The problem is on their side.

## What was measured

| Probe | Result |
|---|---|
| DNS `test.cept.gov.in` | `103.244.127.150` |
| TCP 443 → UAT | **accepted** |
| TLS → UAT, correct SNI | reset, **0 bytes read**, no certificate |
| TLS → UAT, **no** SNI | reset, 0 bytes read |
| TLS → UAT IP, SNI `api.cept.gov.in` | reset, 0 bytes read |
| TCP 80 → UAT | timed out (filtered) |
| TLS → `api.cept.gov.in` (production) | **full handshake, 6080 bytes**, HTTP 403 |
| Cert on `uat.cept.gov.in` | `*.cept.gov.in`, **expired 2026-08-09** |
| Cert on `api.cept.gov.in` | `*.cept.gov.in`, renewed 2026-07-10, valid to 2026-10-08 |

## Why this is their outage, not our access

1. **It fails the same way for every hostname.** No SNI, the wrong SNI and the
   correct SNI all get an identical 0-byte reset. A per-customer IP ACL has no
   reason to depend on SNI, but neither does a working TLS terminator have a
   reason to refuse all three — the box at `103.244.127.150` is not completing
   a handshake with anyone.
2. **TCP is accepted on 443 and dropped on 80.** If a firewall were turning
   this address away, 443 would be filtered the way 80 is. Instead the
   connection is allowed all the way to the service, and the service fails.
3. **Their sibling UAT host is serving a certificate that expired on
   2026-08-09** — eighteen days ago. Their UAT estate is not being maintained.
   Production, on the same wildcard, was renewed on 2026-07-10 and works.
4. **Nothing changed when the whitelist entry was added.** Same errno 54, same
   0 bytes, on repeated attempts.

The honest caveat: some inline inspection appliances do accept TCP and then
reset TLS, so an exotic ACL cannot be ruled out with certainty from outside.
But every other signal points at an expired-certificate outage in their UAT
environment, and the balance is not close.

## The email

To: `integrations.cept@indiapost.gov.in`
Subject: **UAT endpoint test.cept.gov.in resetting TLS — customer 1171865272 / contract 41767647**

> Dear CEPT Integrations team,
>
> We are integrating the beextcustomer APIs for Speed Post against customer id
> 1171865272 / contract 41767647, and are unable to reach the UAT environment.
>
> Our public IP 103.180.89.153 is registered under UAT Environment in the
> Customer Selfservice Portal IP whitelisting page, and shows as configured.
>
> Requests to https://test.cept.gov.in/beextcustomer fail before any HTTP
> exchange takes place. The TCP connection on port 443 is accepted, and the TLS
> handshake is then reset by the peer with zero bytes received — no server
> certificate is presented. This is identical with the correct SNI, with no SNI,
> and with a different SNI, which suggests the TLS listener rather than an
> access rule. Port 80 on the same host times out.
>
> We also note that https://uat.cept.gov.in presents a *.cept.gov.in
> certificate that expired on 9 August 2026. The production host
> api.cept.gov.in presents a valid certificate renewed on 10 July 2026 and
> responds normally, so the issue appears specific to the UAT environment.
>
> Could you confirm whether the UAT environment is currently available, and
> whether test.cept.gov.in remains the correct sandbox host for the
> beextcustomer APIs? If there is a different UAT base URL we should be using,
> please let us know.
>
> Details for reference:
>   Customer id      : 1171865272
>   Contract id      : 41767647
>   Whitelisted IP   : 103.180.89.153 (UAT)
>   Endpoint tried   : POST https://test.cept.gov.in/beextcustomer/v1/access/TokenWithRtoken
>   Observed         : TLS handshake reset, 0 bytes read, errno 54
>   Date observed    : 27 August 2026
>
> Thank you,
> Bisher Talks

## While waiting

Nothing about this blocks the code that is still missing. The adapter seam,
`booking.ts`, `label.ts` and the barcode-stock admin can all be written and
type-checked without a reachable sandbox — only the final verification needs
one. See §4 of [india-post-requirements.md](./india-post-requirements.md).

Re-check with `node scripts/india-post-smoke.mjs`; it reports this exact
failure in one line and prints the current public IP, which is worth
re-confirming each time because a home connection's address changes.
