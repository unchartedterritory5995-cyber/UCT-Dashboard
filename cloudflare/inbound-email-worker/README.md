# UCT inbound-email worker

A Cloudflare **Email Worker**. Cloudflare Email Routing hands it every message
sent to `notes+<token>@<domain>`; it parses the email with
[`postal-mime`](https://www.npmjs.com/package/postal-mime), signs the result and
POSTs it to `https://uctintelligence.com/api/j2/inbound-email`, which turns it
into a note in the member's `Inbox` folder.

The full procedure — DNS, the routing rule, both secrets, the order to switch
things on, and the Privacy page sentence that must be approved first — is
[`docs/notebook/email-in-setup.md`](../../docs/notebook/email-in-setup.md).
This file is only the commands.

## Files

| File | What |
|---|---|
| `src/index.js` | the `email()` handler: parse → payload → sign → POST; throws unless UCT answers `202` |
| `src/sign.js` | the two pure halves (`signBody`, `buildPayload`), dependency-free so the repo's Python tests run them under Node and hold them to the server |
| `wrangler.toml` | name `uct-inbound-email`, `INBOUND_URL`, no public `workers.dev` route |
| `package.json` | **this worker's own** dependencies, pinned exactly (`postal-mime` 3.0.1, `wrangler` 4.140.0). They are not app dependencies and are never installed into `app/`. |

## Commands

Run from this directory (`cloudflare/inbound-email-worker/`), logged in to the
Cloudflare account that owns the domain.

```sh
npm install                      # this directory only
npx wrangler login               # once per machine

# The shared signing secret. Generate it once and keep it for step 3 of the
# setup doc — UCT's web service needs the SAME value.
python -c "import secrets; print(secrets.token_urlsafe(48))"
npx wrangler secret put NOTEBOOK_INBOUND_EMAIL_SECRET   # paste it when asked

npx wrangler deploy              # publish the worker
npx wrangler tail                # watch it handle mail (Ctrl+C to stop)
```

To rotate the secret: put a new value here **and** on UCT's `web` service in the
same few minutes; mail that arrives between the two changes is refused (`401`)
and shows in `wrangler tail`.

## What it sends

```
POST /api/j2/inbound-email
Content-Type: application/json
X-UCT-Timestamp: <unix seconds>
X-UCT-Signature: <hex HMAC-SHA256 of "<timestamp>.<body>" with NOTEBOOK_INBOUND_EMAIL_SECRET>

{"to": "<envelope recipient>", "from": "<envelope sender>", "subject": "…",
 "text": "…", "html": "…",
 "attachments": [{"name": "…", "content_type": "…", "base64": "…"}]}
```

- `to` is the **envelope** recipient (`message.to`), not the `To:` header.
- UCT answers `202 {"accepted": true}` for every message it accepts — including
  one to an address that names nobody, which it drops. `401` means the two
  secrets disagree (or the clock is more than five minutes off); `404` means
  email-in is switched off on UCT.
