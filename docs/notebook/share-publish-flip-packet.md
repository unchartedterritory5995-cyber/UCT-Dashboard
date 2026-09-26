# Share links + publish-to-web: the flip packet (wave 8, lane 8B)

> **What this is.** Everything the owner and the controller need to turn on
> `J2_SHARE_LINKS_ENABLED` (member share links) and `NOTEBOOK_PUBLISH_ENABLED` (publish a
> note or a folder to the web), and to turn them off again. Both **ship OFF in code** and stay
> unset on Railway until the controller flips them after the wave-8 deploy (owner-approved,
> 2026-09-25). Lane 8B set no Railway variable and touched no production system.
>
> The technical half of "is this authorized?" is `docs/notebook/share-links-authorization-proof.md`
> (the proof, and its closure table) and `tests/test_share_publish_authorization.py` (the rail).
> This packet is the other half: the legal questions, the owner's recorded answers, and the
> operational steps.

---

## 1. The legal questions, verbatim — and the owner's recorded answers

### 1.1 What the ledger asks (G-080, `docs/notebook/competitive-gap-ledger.md`, quoted whole)

> | G-080 | Public share link (read-only) | Notion, Evernote, Obsidian (via Publish) | **Implemented, real, substantial** — token-based, sanitized payload (no user id/tags/folder/ticker exposed), widget embeds render as static archived images, revocation final. **ACTIVATION DISABLED 2026-09-07.** ⛔ Discovered during the post-Wave-K re-baseline: `J2_SHARE_LINKS_ENABLED` was **`1` in production** — live, with the member-facing Share UI wired — while this row, the build plan's activation row and the Phase Zero table all recorded it as dark. A bounded authorization-evidence search (decision log, build plan, this ledger, Phase Zero/One rights findings, git history, the flag ledger) found **no affirmative record** that the §21 review was completed or that activation was intentionally approved: the shipping commit `e05e1699b` says "shipped DARK … the Share button is admin-only while the owner evaluates"; `docs/feature_flags.json` carries `status: armed` with an **empty note**; and the Wave F checkpoint restates the standing rule that rights decisions "stay gated on Patrick's external legal review. No new rights approval was sought or assumed." Per owner ruling, the flag was returned to `0`. ⛔ **CONFIGURATION IS NOT AUTHORIZATION** — a sanitized payload, static embeds, a wired UI and an uneventful live period are risk controls and elapsed time, not approval. | Already built; activation is a policy decision, not an engineering one | PARITY (narrow) | All | Low near-term (no evidence this persona needs it yet) | Fork C (confirmed substantial, more built-out than Phase Zero credited); Phase Zero §18 | **IMPLEMENTED — ACTIVATION DISABLED (authorization unverified)** | P2, validate-first before flipping on | §21 legal review (shared vendor-data exposure risk) — Phase Zero §21 states the share link "would need explicit review before ever being enabled" for a note carrying captured vendor data, because a share-link viewer is neither an Authorized User nor an Edge User under the vendor terms | Affirmative, durable evidence that the §21/activation review completed — then, and only then, re-enable. Real usage demand remains the separate product precondition. The implementation is NOT to be deleted.

### 1.2 The questions, as asked

1. **§21:** can a share-link viewer, or a reader of a published page, see captured vendor data?
   A share-link viewer is "neither an Authorized User nor an Edge User under the vendor terms"
   (G-080 above), and a published page's reader is the same stranger.
2. **The archived widget images:** a widget embed on a public page renders its ARCHIVED IMAGE (a
   picture of what the member's screen showed: Massive bars on a chart, an FMP earnings table on
   a fundamentals strip). Is a picture of vendor data vendor data?
3. **G-062, estimates rights:** analyst price-target consensus (`analyst_price_target_consensus`,
   FMP) is `rights_class: conditional` and has NO write path until the external legal review
   approves persistent FMP-derived value storage. Nothing in wave 8 activates it; a fact of that
   type cannot exist in a note today, so it cannot reach a public page either.

### 1.3 The owner's answers, recorded 2026-09-25 (lane 8B brief, both BINDING)

> **L3 "neutral":** share links now use the SAME market-data rule as published pages:
> `widgetEmbed`, `financialFact`, `documentExcerpt` and archived chart images become the neutral
> line on share links too, until FMP and Massive answer in writing. […]
>
> **CORRECTION to the L3 section above (2026-09-25 ~23:2x CT):** FMP and Finnhub licensing is
> APPROVED (the owner arranged it directly). So the market-data reducer replaces ONLY
> Massive-sourced content (chart images / bar widgets) with the neutral line; FMP/Finnhub figures
> (`financialFact`, fundamentals widgets) render on both share links and published pages. Keep the
> vendor decision a single named table inside the reducer (node type -> vendor -> shown/neutral)
> so adding Massive later is a one-line change. `documentExcerpt` follows D-B4 unchanged […].

What the code does with those answers (`api/services/journal_two/public_note_payload.py`,
`MARKET_DATA_VENDORS` + `VENDOR_VERDICT`, railed by `tests/test_public_note_payload.py`):

| Item | Vendor (per the table) | On a share link and a published page |
|---|---|---|
| chart, watchlist, themes, breadth, indexes, optionsflow, periodsort, nhnl, nhnlPulse, volumescan, scatter widgets | Massive | the neutral line: "A market-data item is not shown on public pages." |
| fundamentals widget | FMP (owner-named) | its archived image |
| scanner, marketcontext, aisearch, news, profile, calendar widgets | mixed (not attributable to an approved vendor alone) | the neutral line (L3 as sent; the correction loosened FMP and Finnhub only) |
| notebook, alerts widgets | the member's own private lists | the neutral line |
| financialFact, source `fmp` / `finnhub` | FMP / Finnhub | a plain line: ticker, label, value, captured date |
| financialFact, source `massive` (the `price` fact) | Massive | the neutral line |
| financialFact, source `user` | the member's own words | a plain line |
| financialFact, source `uct_derived`, or rights_class `blocked` | private / blocked | the neutral line |
| documentExcerpt | D-B4, unchanged | the neutral line |

**Loosening Massive later is one line:** `"massive": SHOWN` in `VENDOR_VERDICT`.

### 1.4 ⚠️ OPEN — one question for the owner before the publish flip

**The approved Privacy sentence (L4) and the corrected reducer (L3 correction) disagree about
financial figures.** L4, now on the Privacy page verbatim, says published pages "do not show
[…] market data such as charts and financial figures". After the correction, a published page
DOES show FMP and Finnhub figures (an FMP fundamentals image, an FMP or Finnhub fact line).
Either the sentence or the reducer must move before `NOTEBOOK_PUBLISH_ENABLED` is flipped:

* (a) amend the Privacy sentence (for example: "…or market data such as charts, except figures
  from providers whose terms allow it"), or
* (b) set `"fmp": NEUTRAL` and `"finnhub": NEUTRAL` in `VENDOR_VERDICT` for publish mode only,
  which needs a per-mode verdict (a small change; the table is one place).

Lane 8B did neither: L4 is binding verbatim, and the correction is binding too. The owner picks.

---

## 2. The Privacy page sentence

Approved by the owner (L4, 2026-09-25) and added VERBATIM to `app/src/pages/Privacy.jsx`,
section 4 "Sharing You Control", after the share-links item (rail: `Privacy.test.jsx`, which
asserts the rendered text, the em dash, and the position):

> Published notes and folders — where available, if you publish a note or folder to the web,
> anyone with its address can read it without signing in until you unpublish it. Published pages
> ask search engines not to index them, and they do not show your account, your other notes, file
> attachments, or market data such as charts and financial figures.

See §1.4: the last clause over-promises for FMP and Finnhub figures.

---

## 3. The flip (the controller runs these; lane 8B did not)

```sh
railway variables --service web --set J2_SHARE_LINKS_ENABLED=1
railway variables --service web --set NOTEBOOK_PUBLISH_ENABLED=1
```

One at a time, with §4's verification between them. ⛔ Share links and publishing are separate
gates on purpose: the share flip does not depend on §1.4; the publish flip does.

## 4. Verification — a NEW BOOT, and the value read IN THE PROCESS

`railway variables --set` has been measured both ways (CLAUDE.md, "measured BOTH ways"): it
redeployed `web` on 2026-09-09 and only staged on `chart-renderer` on 2026-08-30. So:

1. After `--set`, watch for a new boot (a startup line stamped after the `--set`; `/api/health`
   `uptime_seconds` reset). Only if none appears within ~3 minutes, `railway redeploy --service web --yes`.
2. Read the value in the RUNNING process, never from `--kv`:
   `railway ssh` → `/opt/venv/bin/python -c "from api.services.notebook_flags import flag_on; print(flag_on('J2_SHARE_LINKS_ENABLED', False), flag_on('NOTEBOOK_PUBLISH_ENABLED', False))"`.
3. Read the auth payload as a signed-in paid member: `GET /api/auth/me` carries
   `j2_share_links_enabled: true` (and `notebook_publish_enabled: true` after the second flip).
4. One public read with a browser User-Agent (Cloudflare 1010-blocks bare curl): an unknown
   token answers `404 {"detail":"Not found"}` with `Cache-Control: no-store, private`,
   `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`.

## 5. The ledger update (same docs push that records the flip time)

In `docs/feature_flags.json`, for each flag flipped: `status` → `armed`, `where` → `web`, and a
note carrying the flip TIMESTAMP and the dated `owner_decision` (the owner's L3/L4 sign-off,
2026-09-25, and the §1.4 resolution for the publish flag). ⚠️ `J2_SHARE_LINKS_ENABLED` already
reads `armed` today — the variable is SET on `web`, to `0` (its note says so); the flip changes the
VALUE, so the note is what must change, with the value, the time and the decision.
`NOTEBOOK_PUBLISH_ENABLED` reads `dark` and moves to `armed`. In
`docs/notebook/competitive-gap-ledger.md`, G-080's status moves from "ACTIVATION DISABLED
(authorization unverified)" to armed, citing this packet and the dated sign-off — the
controller owns that file's wording.

## 6. Rollback

```sh
railway variables --service web --set J2_SHARE_LINKS_ENABLED=0
railway variables --service web --set NOTEBOOK_PUBLISH_ENABLED=0
```

Then verify a NEW BOOT and the in-process value exactly as §4. ⛔ Use `--set …=0`, not
`railway variable delete`: a delete does not restart the service, so the variable can be gone
from the service and still live in the process (CLAUDE.md, measured 2026-09-17).

What rollback does: every share and publish route answers the one 404 at once (the gate is a
router dependency, read per request) — public pages, images, and the owner doors alike. No row
is deleted: turning a gate back on restores every link and page that was not revoked or expired
in the meantime. ⛔ A kill switch is never a DELETE against member data.

## 7. What members see, and when

* **Share links on:** a paid member sees **Share** in the note editor's header. It opens one
  popover: **Create link** with **Link stops working** Never / After 7 days / After 30 days /
  After 90 days; then **Copy link** and **Revoke link** ("It stops working immediately.").
  Settings shows **Sharing & publishing** with every link, its dates, its state, and **Revoke**.
* **Publishing on:** the same popover adds **Publish to the web**: **Publish this note**, **Copy
  page link**, **Unpublish**, and, when the note is in a folder, **Publish folder "<name>"** (up
  to 500 notes, newest first; the popover says so). Settings adds every page with **Revoke**,
  and **Update** on folder pages.
* **A member whose plan lapsed** keeps Settings → Sharing & publishing: they can see and revoke
  every link and page; they cannot create new ones (ruling D-B3).
* **Reach:** the two flags ride the auth payload and are latched for the life of a tab
  (`lib/offline/notebookFlags.js`). A flip reaches a member on their next load of the app — a
  reload or a new tab — not a tab that is already open. The SERVER gate is read per request, so
  on the public side a flip (or a rollback) takes effect on the very next request.

## 8. What a public page renders, and what it never renders

Both lists are the reducer's (`public_note_payload.NODE_POLICY`), and every "never" item is a
named assertion in `tests/test_public_note_payload.py` (the `test_never_*` tests, run against a
published note); the share and publish payloads are also scanned for forbidden strings in
`tests/test_share_publish_authorization.py` (test 5).

**Renders:** the title, the subtitle, the hero image (never a YouTube hero), and the body:
prose, headings, lists, tasks, tables, callouts, toggles, columns, code, math, dates, the
member's own images (this note's only), external links, link previews and allowlisted web
embeds; writing-help blocks with their label; FMP/Finnhub figures and member facts as plain
lines (§1.3); a link to another note of the SAME published folder, as a link to its page.

**Never:**

* Ask answers (published pages; a share link keeps the G-064 behaviour: the answer's own text,
  its citations reduced to numbers);
* `askCitation` chips (published pages; numbers only on a share link);
* properties;
* tags, the folder path (beyond the published folder's own name), the ticker;
* trade links;
* backlinks and unlinked mentions;
* other notes' titles or ids ("linked note" in their place);
* `file` attachments;
* vendor-data nodes the table marks neutral (the neutral line in their place);
* the author's identity (no user id, no name, no email).

Always: `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` on the HTML and
every API response, `Cache-Control: no-store, private` on every API response, and the same two
in `<meta>` tags on the page itself.
