# Email to Notebook — setup, secrets, and the order to switch it on

A member sends or forwards an email to their private address,
`notes+<token>@<domain>`, and it becomes a note in their Notebook's **Inbox**
folder: the subject is the title, the text is the body, the attachments come
with it.

> **Status (wave 7, 2026-09-25): built and DARK** behind
> `NOTEBOOK_INBOUND_EMAIL_ENABLED`. Unset means every route answers `404`, the
> Settings card does not appear, and no address is ever minted. Lit, an address
> exists only once the member presses **Create my address**
> (`POST /api/j2/inbound-email/address`); the GET answers `{"address": null}`
> until then.
> ⛔ **It stays dark until the owner approves the Privacy page sentence in §1**
> — it names Cloudflare as a processor of these emails — and until the secret,
> the edge rule and the routing rule in §4–§6 are set and the first message has
> reached UCT while the gate is still dark (§7 step 7). ⛔ The edge rule (§5a)
> is **NOT VERIFIED** on the live account. This wave does **not** edit
> `Privacy.jsx`; public copy is the owner's ship gate.

```
sender ──SMTP──▶ Cloudflare Email Routing  (rule: notes+*@<domain>)
                   │
                   ▼
                 Email Worker "uct-inbound-email"      cloudflare/inbound-email-worker/
                   │  parse MIME (postal-mime) → JSON payload
                   │  sign: HMAC-SHA256("<unix ts>.<body>", NOTEBOOK_INBOUND_EMAIL_SECRET)
                   ▼
                 POST https://uctintelligence.com/api/j2/inbound-email
                   │  this zone's own edge rules run FIRST: a 403 here never reached UCT (§5a)
                   │  401 (no body) unless the signature and the 5-minute window check out
                   │  202 {"accepted": true} for every accepted message — known address or not
                   ▼
                 a note in that member's Inbox       api/services/journal_two/inbound_email.py
```

---

## 1. The Privacy page sentence (owner approval needed first)

`Privacy.jsx` already lists Cloudflare as *"network delivery and security for our
website, and storage for backups of our account database (Cloudflare R2)"*.
Email-in adds one more thing Cloudflare does with member content. **Drafted for
the owner — replace the Cloudflare bullet with:**

> **Cloudflare** — network delivery and security for our website, storage for
> backups of our account database (Cloudflare R2), and, if you use your
> Notebook email address, receiving those emails and passing them to us
> (Cloudflare Email Routing and Workers). Cloudflare handles those messages only
> to deliver them to UCT.

Why this is a small change rather than a new vendor: every page of the site and
every note a member types already travels through Cloudflare's network. What is
new is that the *content of an email* is parsed by a Cloudflare Worker before it
reaches UCT. ⚠️ The claim "only to deliver them" rests on Email Routing
forwarding without storing and on the worker keeping nothing (it holds the
message in memory for one request); Cloudflare's own terms were **not
re-checked** for this draft — do that before approving (the vendor record is
`docs/notebook/VENDOR-TERMS-2026-09-23.md`).

---

## 2. Choose the mail domain (read before touching DNS)

⛔ **Enabling Email Routing on a zone puts Cloudflare's MX records on it.** If
anything already receives mail at `@uctintelligence.com` (a Google Workspace
or Microsoft 365 mailbox, a support inbox, Resend inbound), switching the root
domain over would stop that mail arriving there. Whether the root domain has MX
records today was **not measured** for this doc. Check first:

```sh
nslookup -type=mx uctintelligence.com
```

- **No MX, or nothing that matters:** use the root domain. Nothing else to set.
- **Real mail already arrives there:** put Email Routing on a subdomain instead,
  for example `in.uctintelligence.com`, and tell UCT which one by setting
  `NOTEBOOK_INBOUND_EMAIL_DOMAIN=in.uctintelligence.com` on the `web` service.
  Addresses then read `notes+<token>@in.uctintelligence.com`, and mail to any
  other domain is ignored.

Resend (outgoing mail) is unaffected either way: it sends, it does not receive.

## 3. The DNS records Email Routing needs

Cloudflare creates these for you when you enable **Email → Email Routing** on
the chosen domain, and shows any conflict before it does. What Cloudflare
documents, for checking the dashboard's work (the dashboard is authoritative):

| Type | Name | Value |
|---|---|---|
| MX | the domain | `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`, `route3.mx.cloudflare.net` (priorities as Cloudflare sets them) |
| TXT (SPF) | the domain | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT (DKIM) | the selector Cloudflare lists | the key Cloudflare provides |

⚠️ A name may carry only **one** SPF record. If the chosen domain already has one
(for example for Resend), **merge** the `include:` into it rather than adding a
second record.

## 4. Deploy the worker and its secret

Commands (run in `cloudflare/inbound-email-worker/`): see that directory's
`README.md`. In short:

```sh
npm install
npx wrangler login
python -c "import secrets; print(secrets.token_urlsafe(48))"      # the shared secret
npx wrangler secret put NOTEBOOK_INBOUND_EMAIL_SECRET               # paste it
npx wrangler deploy
```

## 5. The two secrets (one value, two places)

| Where | Name | How |
|---|---|---|
| the worker | `NOTEBOOK_INBOUND_EMAIL_SECRET` | `npx wrangler secret put NOTEBOOK_INBOUND_EMAIL_SECRET` |
| UCT `web` | `NOTEBOOK_INBOUND_EMAIL_SECRET` | `railway variables --service web --set "NOTEBOOK_INBOUND_EMAIL_SECRET=<same value>"` |

They must be identical. If they are not, every message is refused `401` and the
worker's log (`npx wrangler tail`) says so. `web` with no secret refuses every
message: there is no unsigned mode.

⚠️ `railway variables --set` has restarted `web` every time it was measured, and
`--kv` shows only what the service is configured with — confirm the value in the
running process after the boot (CLAUDE.md, *"railway variables --set — measured
BOTH ways"*).

## 5a. Let the worker's request through Cloudflare's edge (before the routing rule)

⛔ **NOT VERIFIED on the live account, and a flip precondition** (whole-branch
review I-1). The worker POSTs to the PUBLIC hostname (`INBOUND_URL` in
`wrangler.toml`), so its request enters this zone's edge like any visitor's —
Cloudflare documents that a Worker's subrequest to its own zone passes through
the zone's rules. This zone refuses non-browser clients with error **1010**
(CLAUDE.md: *"Cloudflare 1010-blocks raw curl/python UAs"* to
uctintelligence.com), which is **Browser Integrity Check**, and the worker is
exactly such a client. What was **not measured**: whether Browser Integrity
Check fires on an Email Worker's request, and whether Bot Fight Mode is on for
the zone. The first message in §7 step 7 is what finds out — before any member
can send one.

In the Cloudflare dashboard, zone `uctintelligence.com` → **Security → WAF →
Custom rules → Create rule**:

- **Name:** `email-in door skips BIC`
- **Expression:**
  `(http.host eq "uctintelligence.com" and http.request.uri.path eq "/api/j2/inbound-email" and http.request.method eq "POST")`
- **Action:** **Skip** → **Browser Integrity Check**. If the zone's plan offers
  **Super Bot Fight Mode**, skip that too. Free-plan **Bot Fight Mode** cannot be
  skipped by a custom rule, so read **Security → Settings** first; if it is on,
  that is a separate decision.
- **Order:** first.

Equivalent: a **Configuration Rule** with the same expression that sets
**Browser Integrity Check: Off**. Nothing is lost by skipping it on this one
path: the door answers a bare `401` to any request without a valid signature
(§9).

⚠️ The worker names itself — it sends
`User-Agent: uct-inbound-email/1 (+https://uctintelligence.com)` — so Security →
Events can tell its requests apart. **That does not replace the rule**: a
non-browser user agent is exactly what the zone refuses.

## 6. The routing rule

In the Cloudflare dashboard, **Email → Email Routing** on the chosen domain:

1. **Settings → Subaddressing: on.** With subaddressing, `notes+anything@` is
   delivered by the rule for `notes@`.
2. **Routing rules → Create address:** custom address `notes@<domain>` →
   action **Send to a Worker** → `uct-inbound-email`.

If subaddressing is not offered on the account, use the **catch-all** rule →
**Send to a Worker** → `uct-inbound-email` instead: UCT itself drops every
recipient that is not `notes+<token>@<its domain>`. (The dashboard labels here
are from Cloudflare's documentation; they were **not measured** against the live
account.)

---

## 7. The flip order

Each step is safe to stop after. Nothing a member can see changes until step 8.

1. **The owner approves §1**, and the sentence is added to `Privacy.jsx` and
   deployed. Nothing else happens first.
2. **Secret on `web`** (§5). Verify a new boot and the value in-process.
3. **Deploy the worker with its secret** (§4).
4. **DNS** (§2–§3): Email Routing on the chosen domain; if a subdomain, set
   `NOTEBOOK_INBOUND_EMAIL_DOMAIN` on `web` too.
5. **The edge rule** (§5a) — the WAF custom rule that skips Browser Integrity
   Check for the worker's POST, ordered first. ⛔ Not verified on the live
   account; step 7 is the check.
6. **The routing rule** (§6). No member has an address yet (the Settings card
   is still hidden), so nothing real can arrive.
7. **The first message, with the gate still DARK.** `NOTEBOOK_INBOUND_EMAIL_ENABLED`
   is still unset. In `cloudflare/inbound-email-worker/`, run `npx wrangler tail`
   and send an email to `notes+000000000000000000000000@<domain>`:
   - **Pass:** the tail shows `UCT refused the message: HTTP 404`. The request
     reached UCT, and a dark door answers `404` (the worker throws on anything
     but `202`, so a throw is what passing looks like here).
   - **`HTTP 403`** (Cloudflare's error 1010 is a `403`): the EDGE refused the
     request before UCT saw it. Open **Security → Events**, filter on the path
     `/api/j2/inbound-email`, read which product blocked it, fix the §5a rule,
     and resend until the tail reads `404`.
   - Do not go on to step 8 until it reads `404`. ⛔ This is the flip
     precondition the edge rule has, and it has **not** been run on the live
     account.
8. **`railway variables --service web --set "NOTEBOOK_INBOUND_EMAIL_ENABLED=1"`.**
   Verify the boot and the value in-process. The **Email to Notebook** card
   now appears in Settings (once the controller's Settings mount has shipped).
9. **Walk it:** Settings → Email to Notebook → **Create my address** (the card
   shows no address until the member asks for one — opening Settings mints
   nothing) → copy the address → send it an email with a subject, some text and
   a small PDF → the note appears in **Inbox** with the PDF attached;
   `npx wrangler tail` shows a `202`. Send one to a made-up
   `notes+000000000000000000000000@<domain>`: it must produce a `202` in the
   tail and **no** note anywhere.
10. **Check the limits are the ones you want** before any member has an address
   — they are constants in `api/services/journal_two/inbound_email.py`, so a
   change is a code change and a deploy, not a variable:

   | Limit | Per address | Per member (every address they have had) |
   |---|---|---|
   | Messages | 20 in any rolling hour | 40 in any rolling hour |
   | Volume (signed request bytes, attachments included) | 50 MiB in any rolling day | 100 MiB in any rolling day |

   Mail over a limit — or to a member whose plan has lapsed — is answered
   `202` exactly like any other and **not** turned into a note. Each drop is
   recorded: one row per member, UTC day and reason in `j2_inbound_drops`
   (`address_rate`, `address_volume`, `member_rate`, `member_volume`,
   `not_paid`), and a `[inbound-email] dropped for <user id>: <reason>` log
   line. The windows live in `auth.db` (`j2_inbound_usage`), so a restart does
   not reset them. Walk it once: send 21 emails to one address inside an hour
   and confirm the 21st produces no note and a `address_rate` row.
11. **Record the flip** in `docs/feature_flags.json`: `status` `armed`, `where`
   `["web"]`, and the flip time in the note — in the same docs push.

### Reading `npx wrangler tail`

The worker throws on any answer but `202`, naming the HTTP status:

| The tail shows | What it means | What to do |
|---|---|---|
| no error | UCT accepted the message (`202`) — including one to an address that names nobody, which it drops | nothing |
| `HTTP 401` | the two secrets disagree, or the worker's clock is more than five minutes off | §5 |
| `HTTP 403` | **Cloudflare's edge refused the request before it reached UCT** — Browser Integrity Check (error 1010), Bot Fight Mode or another WAF rule | §5a: Security → Events filtered on `/api/j2/inbound-email`, fix the rule, resend |
| `HTTP 404` | it reached UCT and email-in is switched off (`NOTEBOOK_INBOUND_EMAIL_ENABLED` unset) — the expected answer in §7 step 7 | flip it when ready (§7 step 8) |
| `HTTP 413` | the signed request was over UCT's 36 MB cap | §8, *Size* |

### Rolling back

- **Fastest:** `railway variables --service web --set "NOTEBOOK_INBOUND_EMAIL_ENABLED=0"`.
  Every route answers `404` on the next request, the card disappears, and the
  worker's `fetch` gets a `404` and throws — visible in `wrangler tail`; how
  Cloudflare then reports the failure to the sender was **not measured**. Then
  disable the routing rule so no more mail reaches the worker.
- **One member's address is out in the wild:** they choose **Make a new
  address** in Settings; the old one stops working at once.
- **The secret leaked:** put a new one in both places (§5) within the same few
  minutes.

---

## 8. What happens to a message

- **Who it is for** is decided by the address alone: the `<token>` in
  `notes+<token>@<domain>` of the **envelope** recipient. From, Reply-To and
  headers are never trusted to pick a member. A token is 24 random hex
  characters (96 bits).
- **An address that names nobody** (never issued, or retired by *Make a new
  address*) is answered exactly like a real one — `202` — and dropped. No
  answer, anywhere, says which addresses exist.
- **Title:** the subject, or `Email <YYYY-MM-DD>` (the Eastern-time day) when
  there is none.
- **Body:** the plain-text part, read as Markdown; if there is no plain-text
  part, the HTML part through the same converter the importer uses. Text over
  200 KB (HTML over 1 MB) is cut with a line saying so. **Images referenced by
  URL are never fetched** — they appear as `[image: <url>]`, which also defeats
  tracking pixels.
- **Folder:** `Inbox`, at the Notebook's top level, made the first time.
- **Attachments** are saved through the Notebook's own upload rules: PNG, JPEG,
  GIF and WebP images up to 5 MB; PDF, text, CSV, Markdown, ZIP, MP3/M4A, DOCX
  and XLSX files up to 25 MB; at most 20 per email. **HEIC photos are refused**
  (send as JPEG). A refused attachment becomes one line in the note saying
  which and why — never a lost email. Each saved attachment is handed to the
  document pipeline like any upload (a PDF becomes searchable; images and DOCX
  too once `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` is on).
- **Size:** Cloudflare Email Routing's own message limit applies before UCT
  sees anything (documented by Cloudflare as 25 MiB; not measured here). UCT
  refuses a request body over 36 MB — by its declared `Content-Length` before
  reading anything, and otherwise as soon as the running total passes the cap,
  so an oversized body is never buffered whole.
- **Limits and plan:** the address and the member are each held to a message
  rate and a daily volume, and the member must still be on a plan that includes
  Email to Notebook (§7 step 10). Over a limit, or on a lapsed plan, the mail is
  answered like any other and recorded as a drop — no note.
- **A body the converter cannot handle** (for example thousands of nested
  `<div>`s) still becomes a note: its text is kept as plain paragraphs under a
  line saying the formatting could not be kept.
- **Attachments are appended** to whatever the note holds by the time they are
  saved, inside one locked read-and-write, so an edit made in those
  milliseconds is kept and the attachments are still linked. If that brand-new
  note is already open in a browser tab while they are saved (rare: the window
  is the few seconds the attachments take), the tab follows the same rule as
  every other append (`personal-api.md` §4, ruling D-G5): a tab with nothing
  unsent picks the attachments up when it becomes visible again or its window
  regains focus; a tab that stays visible and focused while they land saves a
  conflict copy on its next keystroke instead; words the tab has not sent yet
  always go to a conflict copy. Nothing is lost either way.
- **Links** whose address is not an allowed kind once whitespace and control
  characters are removed (for example `java&#9;script:`) keep their words and
  lose the link. A placeholder for a file the email did not carry becomes a
  line `[attachment: <name>]`.

## 9. Security, in one place

- **Signature:** `X-UCT-Signature` = hex HMAC-SHA256 of `"<X-UCT-Timestamp>.<raw
  body>"` with `NOTEBOOK_INBOUND_EMAIL_SECRET`. The timestamp is inside the
  signed bytes, so a captured request cannot be replayed under a new timestamp;
  anything more than five minutes old (or ahead) is refused. The comparison is
  constant-time. A refusal is a bare `401` with no body.
- **One delivery per signature:** a captured request replayed *within* its five minutes is
  answered `202` like any other and makes nothing — no note, and no charge against the address's hourly
  allowance. The server keeps a hash of each verified signature in `j2_inbound_seen` (auth.db) until
  the instant it could no longer verify, pruned on every delivery (`inbound_email.claim_delivery`).
  The Email Worker signs every POST afresh, so a genuine retry never carries an old signature.
  ⚰️ Before the wave-7 whole-branch fix (M-6) a replay was not de-duplicated: up to 20 replays an hour
  each made a copy of the note and spent the address's rolling allowance, so the member's genuine mail
  was then dropped for up to an hour — not merely "a second copy of the note".
- The worker and the server share their signing and payload code's contract
  through a test that RUNS the worker's `src/sign.js` under Node
  (`tests/test_notebook_inbound_email.py::TestWorkerParity`).

## 10. For operators

- Gate `NOTEBOOK_INBOUND_EMAIL_ENABLED` (`1`/`true`/`yes`/`on`), secret
  `NOTEBOOK_INBOUND_EMAIL_SECRET`, optional `NOTEBOOK_INBOUND_EMAIL_DOMAIN`
  (default `uctintelligence.com`). All read per request.
- Code: `api/routers/notebook_inbound_email.py`,
  `api/services/journal_two/inbound_email.py` (tables `j2_inbound_addresses`,
  `j2_inbound_usage` and `j2_inbound_drops`, created on first use, removed with
  the account by `account_purge.py`; `inbound_email.drops(user_id)` reads a
  member's recorded drops; and `j2_inbound_seen` — signature hashes for the
  replay window; names no member, so it is not in the account purge),
  `cloudflare/inbound-email-worker/`, the Settings card
  `app/src/pages/journal-2-0/components/InboundEmailCard.jsx`.
- Rails: `tests/test_notebook_inbound_email.py`, `InboundEmailCard.test.jsx`.
