# Share links: the authorization proof (technical half of G-080)

> **Scope.** The TECHNICAL half of the G-080 authorization: what the code proves about who
> can read, mint, revoke and see a note share link, and where it proves nothing. The legal
> half (the section 21 vendor-data question, and G-062 estimates rights) is the owner's.
> This document asks nothing of it and answers nothing for it (ruling D8, D-B9).
>
> **Provenance.** Part 1 was written **before any lane-8B code change**, against
> `feat/notebook-w8` at `3a3ab8ae7` (wave-8 seams S8-1 to S8-5 landed). Every `file:line`
> in Part 1 was read at that commit, and nothing in Part 1 was edited after the fixes
> landed. The record of what existed must not be written after the fix.
> Part 2 (the closure table) is appended by the later lane-8B commits and names the commit
> that closes each finding.

---

## Part 1 — what the code at `3a3ab8ae7` proves

### 1.1 The surface

Five routes, all under the prefix `/api/j2`, served by `api/routers/notebook_shares.py`
(moved byte-for-byte out of `journal_two.py` by seam S8-2; mounted before `journal_two`):

| # | Method and path | Handler | Auth | Gate |
|---|---|---|---|---|
| 1 | `GET /notes/{note_id}/share` (status) | `notebook_shares.py:38-42` | `get_current_user` | flag, in the handler body `:40-41` |
| 2 | `POST /notes/{note_id}/share` (mint) | `notebook_shares.py:45-52` | `get_current_user` | flag, `:47-48` |
| 3 | `DELETE /notes/{note_id}/share` (revoke) | `notebook_shares.py:55-59` | `get_current_user` | flag, `:57-58` |
| 4 | `GET /shared/{token}` (public read) | `notebook_shares.py:62-72` | none | flag, `:67-68` |
| 5 | `GET /shared/{token}/att/{sub}/{filename}` (public image) | `notebook_shares.py:75-84` | none | flag, `:79-80` |

The service is `api/services/journal_two/note_shares.py` (203 lines). The table is
`j2_note_shares(token PK, note_id, user_id, created_at, revoked_at)`
(`api/services/journal_two/db.py:1298-1306`), with an index on `(note_id, user_id)`
(`:1305-1306`). The frontend: `SharedNotePage.jsx` (public, shell-less), the link constants
in `lib/noteShareLink.js`, and the editor door `components/notebook/NoteShareControls.jsx`.

### 1.2 Property by property

Each row: the property, the `file:line` that provides it (or fails to), the rail that pins
it today, and the finding where there is a gap.

| # | Property | Provided by | Rail today | Finding |
|---|---|---|---|---|
| P1 | **The gate is one parse, read per request** | `note_shares.enabled()` = `flag_on("J2_SHARE_LINKS_ENABLED", False)` (`note_shares.py:38-47`); every handler checks it first (`notebook_shares.py:40,47,57,67,79`) | `tests/test_notebook_flag_parse.py` (payload == gate over the value table); `tests/test_journal_two_share_router.py:71-93` (owner-side three 404 while off); `test_note_shares.py:85-89` (service) | none for the parse. **F-GATE-ORDER:** the flag check is in the handler BODY, so it runs AFTER the route's dependencies. Today every dependency is `get_current_user`, which reads no data, so nothing leaks; but any gate added as a dependency (a plan check) would answer before the flag, and a flag-off route would then answer 401/402 instead of the not-found every other state gives. |
| P2 | **Owner-only mint** | `create_share` refuses a note that is not the caller's, or is in the trash: `_owned` (`note_shares.py:50-61`, `WHERE id = ? AND user_id = ? AND deleted_at IS NULL`), called at `:86-87` | `test_note_shares.py:68-70` (u2 cannot share u1's note); `:94-97` (trashed) | none |
| P3 | **Owner-only revoke** | `revoke_share` updates `WHERE note_id = ? AND user_id = ? AND revoked_at IS NULL` (`note_shares.py:109-112`) | `test_note_shares.py:73-82` covers the owner's own revoke. **No rail** asserts that a second member's revoke leaves the owner's token alive. | **F-REVOKE-RAIL:** the predicate is right, and unrailed: deleting `AND user_id = ?` turns every member into a revoker of every note id they can guess, and no test goes red. |
| P4 | **Owner-only status** | `get_share` reads `WHERE note_id = ? AND user_id = ? AND revoked_at IS NULL` (`note_shares.py:69-73`) | none for the foreign case | **F-STATUS-RAIL:** same shape as P3: right, unrailed. |
| P5 | **No owner-side oracle** | status answers `{"share": null}` for a foreign and a missing note alike (`notebook_shares.py:42`); mint answers 404 `"note not found"` for both (`:50-51`); revoke answers `{"revoked": false}` for both (`:59`) | none | **F-BODIES:** the flag-off body is `"Not found"` (`notebook_shares.py:41,48,58,68,71,80,83`) and a missing note's mint body is `"note not found"` (`:51`). Both are 404, but the bodies differ, so a caller can tell "the feature is off" from "no such note" by reading the body. There is no rail pinning either body. |
| P6 | **Token entropy** | `secrets.token_urlsafe(24)`: 24 random bytes, 192 bits, 32 URL-safe characters (`note_shares.py:91`) | none | **F-ENTROPY-RAIL:** strong, and unrailed: `token_urlsafe(4)` (32 bits) passes every test in the repo. |
| P7 | **One active token per note** | `create_share` returns the existing active token before minting (`note_shares.py:88-90`) | `test_note_shares.py:55-56` (idempotent re-mint) | none |
| P8 | **Expiry** | nothing: the table has no expiry column (`db.py:1298-1304`), and every read checks only `revoked_at IS NULL` | none | **F-EXPIRY:** a link lives until revoked or until its note is trashed. There is no way to make a link that stops on its own. |
| P9 | **Revocation is immediate** | resolve re-reads `revoked_at IS NULL` on every call (`note_shares.py:150-153`), and so does the image proxy (`:193-196`); there is no module-level cache | `test_note_shares.py:73-82` (resolve), `:128-129` (image) | **F-NO-STORE:** the SERVER forgets at once; a CDN or a browser need not. The public JSON is returned with FastAPI's defaults and the image proxy returns a bare `FileResponse(str(path))` (`notebook_shares.py:84`): neither carries `Cache-Control`. The image path ends in `.png`, so a CDN that caches by extension could keep serving a revoked image. Whether this zone's Cloudflare rules cache `/api/*.png` is **not verified**; the fix is to make that question moot. |
| P10 | **A trashed note stops serving** | `resolve_share` loads through `notes_service.get_note` (`note_shares.py:157`), whose default filter is `deleted_at IS NULL` (`notes.py:2671-2673`) | `test_note_shares.py:100-111` | none |
| P11 | **An archived note stops serving** | nothing: `get_note` does not read `archived_at` (`notes.py:2671-2674`) | none | **F-ARCHIVED:** an archived note keeps serving publicly. Archive is not trash, but a member who archives a note expects it off the shelf; and a publication (lane 8B) must stop serving on archive, so the two public surfaces would disagree. |
| P12 | **No account data in the payload** | the payload is exactly `{title, subtitle, bodyJson, heroImageUrl, updatedAt}` (`note_shares.py:166-172`) | `test_note_shares.py:63-65` asserts six absent keys at the TOP LEVEL only | **F-EXACT-KEYS:** the rail lists keys that must be absent; it would not notice a seventh key being added. |
| P13 | **No data beyond the note, inside the body** | only `askCitation` is reduced (to `{n}`, `note_shares.py:132-142`); every other node ships as stored | `test_note_shares.py:132-153` (citations) | **F-BODY-LEAKS**, several: **(a)** a `noteLink` carries the TARGET note's id (`lib/noteLinkNode.jsx:34`), and the public page mounts `NoteLinkView`, which fetches the target's title with the VIEWER's cookie (`NoteLinkView.jsx:21`, through `lib/noteLinkTargetsBatch.js:45`). A stranger sees "Note unavailable"; the id is in the JSON regardless. **(b)** a `widgetEmbed` ships `tradeRef` (names a member's trade), `searchText`, `params` and `annotations` (`lib/widgetEmbedNode.jsx:56,79,80,83`), although the public page renders only the archived image. **(c)** an image copied from ANOTHER note keeps its owner-only URL, `/api/j2/notes/attachments/{user_id}/{other_note_id}/...` (the rewrite covers this note only, `note_shares.py:121-129`, and its own docstring says so at `:122-125`), so the member's user id and another note's id are in the public JSON. **(d)** an `attachmentChip` (PDF/CSV) ships its file name and a link the proxy refuses (`note_shares.py:188-189`). **(e)** a `financialFact` and a `documentExcerpt` ship internal ids (`factId`, `excerptId`: `lib/financialFactNode.jsx:31`, `lib/documentExcerptNode.jsx:27`). **(f)** a `link` mark the member pasted that points inside the app (another note, a trade) ships as written. |
| P14 | **Vendor data** | the public page renders widget embeds as their ARCHIVED IMAGES (`SharedNotePage.jsx:80-85` sets `shareView` before create; `WidgetEmbedView.jsx:151` reads the flag, and `:526-527` keeps the body `archived` whenever `shareView`) | `sharedNote.route.test.jsx:78-85` | **F-VENDOR:** an archived chart image shows Massive-sourced bars to a stranger. That is the section 21 question, and it is not the code's to answer (section 1 of `share-publish-flip-packet.md` carries it). The code must make the owner's answer a small, named change. |
| P15 | **Images: only this note's images** | `resolve_share_attachment` serves only `inline`/`hero` (`note_shares.py:188-189`), re-checks `revoked_at IS NULL` (`:193-196`), and hands off to `notes_service.serve_note_image_path`, which rejects any filename with a separator or a leading dot (`notes.py:4817-4818`) and anchors containment on the real attachment root (`:4834-4839`) | `test_note_shares.py:114-129` (in-scope serves, `file` refused, `..` refused, bad and revoked token refused) | none for scope. The encoded-separator case (`%2F`) is not railed; it cannot reach the handler as a single segment, but nothing asserts so. |
| P16 | **Rate limits** | nothing: no limiter call on any of the five routes; `api/limiter.py` (`Limiter(key_func=client_ip)`) is unused here | none | **F-RATE:** a token can be guessed at request rate, and a hot link can be fetched without bound. 192 bits makes guessing hopeless; the missing limit is about load and about a leaked link being scraped. |
| P17 | **Plan** | mint takes `get_current_user` (`notebook_shares.py:46`), not a paid check | none | **F-PLAN:** any signed-in member, paid or not, can mint (ruling D-B3 wants mint paid-gated). |
| P18 | **Referrer** | links inside notes render `rel: 'noreferrer', target: '_blank'` (`lib/tiptap.js:109`); the SPA HTML under `/share/n/` carries `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow` (`api/main.py:10964-10981`, seam S8-4, rail `tests/test_public_note_headers.py`) | S8-4's rail | **F-API-HEADERS:** the two API responses (the JSON and the image) carry neither header. The HTML is covered; the data it loads is not. |
| P19 | **Indexing** | the SPA HTML is noindex (P18); `app/public/robots.txt` does not disallow `/share` (correct: a crawler that may not fetch a page never sees its noindex); `app/public/sitemap.xml` is static | S8-4's rail | **F-IN-PAGE-META:** the page itself carries no `<meta name="robots">` or `<meta name="referrer">`; a copy of the HTML served without the header (a cache, a mirror) says nothing. |
| P20 | **Who sees the Share door** | the editor's controls are gated on `user?.role === 'admin'` (`NoteShareControls.jsx:24,55`), not on the flag | none | **F-ADMIN-GATE:** flipping the flag would reach nobody but admins. The door must read the payload flag (`j2_share_links_enabled`, S8-1) and the member's plan. |
| P21 | **A public GET writes nothing** | `resolve_share` reads through `notes_service.get_note`, which lazily backfills `first_image_url` with an `UPDATE` on first read (`notes.py:2682-2689`) | none | **F-READ-WRITES** (minor): the first public read of an older note can write one column of the owner's row. Harmless in content (the owner's own derived value), recorded because the rails below assert "nothing is written" only where the gate is off or the caller is refused. |
| P22 | **Purged with the account** | `j2_note_shares` is in `_DIRECT_USER_TABLES` (`account_purge.py:82`) | `tests/test_account_deletion_manifest.py` (doc vs purge code) | none |

### 1.3 What today's code does prove

- A token is an unguessable capability (P6), one per note (P7), minted only by the note's
  owner (P2) and only for a live note (P2, P10).
- Revocation is final on the server with no cache (P9), and a revoked token serves neither
  the note nor its images (P9, P15).
- The public image proxy cannot reach a file outside the note's own image directory (P15).
- The whole surface is dark behind one per-request parse (P1), and has been `0` on web since
  2026-09-07 (G-080).

### 1.4 What it does not prove (the findings, in one list)

F-GATE-ORDER · F-REVOKE-RAIL · F-STATUS-RAIL · F-BODIES · F-ENTROPY-RAIL · F-EXPIRY ·
F-NO-STORE · F-ARCHIVED · F-EXACT-KEYS · F-BODY-LEAKS (a-f) · F-VENDOR · F-RATE · F-PLAN ·
F-API-HEADERS · F-IN-PAGE-META · F-ADMIN-GATE · F-READ-WRITES.

The brief's seven known findings map onto these: no expiry = F-EXPIRY; no rate limit =
F-RATE; mint not paid-gated = F-PLAN; the image proxy's bare `FileResponse` = F-NO-STORE;
`tradeRef`/`searchText`/`params` and noteLink ids = F-BODY-LEAKS (a, b); the two 404 bodies =
F-BODIES; the admin gate = F-ADMIN-GATE. The rest were found while reading for this document.

---

## Part 2 — closure (appended by the lane-8B commits)

*Filled in by the commit that closes each finding. The rail named is the one that goes red
if the fix is undone; the mutation row in `wave8-8B-report.md` shows it doing so.*

### 2.1 Closed by the B1 + B2 commit (the authorization rail and the hardening)

| Finding | Closed how | Rail (red if undone) |
|---|---|---|
| F-GATE-ORDER | The gate is a ROUTER dependency (`notebook_shares.py`, `APIRouter(dependencies=[Depends(_require_enabled)])`), so it runs before any route's own dependencies: flag off answers the one 404 before the session or the plan is read. | `test_8_with_the_gate_off_every_route_answers_404_and_nothing_runs` (every row, with spies and a table snapshot; `test_8_control_the_spies_can_see_a_call` is its control) |
| F-REVOKE-RAIL | Unchanged predicate, now railed. | `test_1_member_B_cannot_touch_A_and_the_answer_equals_a_missing_id[DELETE ...]` (M1 in the report) |
| F-STATUS-RAIL | Unchanged predicate, now railed. | `test_1_...[GET /api/j2/notes/{note_id}/share]` |
| F-BODIES | Every public miss and the flag-off path answer `public_note_payload.not_found()`: one status, one body (`"Not found"`), one header set. Mint on a foreign or missing note answers the same 404. | `test_7_every_dead_token_answers_byte_identically` (unknown, revoked, expired, trashed, archived, flag off; page AND image; M7 in the report) |
| F-ENTROPY-RAIL | `TOKEN_BYTES = 24` named; mint calls `secrets.token_urlsafe(TOKEN_BYTES)`. | `test_2_share_tokens_are_at_least_128_bits_and_all_distinct` (1,000 minted tokens plus the structural read; M2) |
| F-EXPIRY | Optional expiry per link, never / 7 / 30 / 90 days (ruling D-B2); `expires_at` is self-ensured by `note_shares.ensure_share_schema` (PRAGMA + ALTER, never `db.py`). An expired link answers the unknown-token 404 on the page and the image. Anything else in `expiresInDays` is a 422 with one sentence. | `test_3_an_expired_share_answers_the_unknown_404_on_resolve_and_image`, `test_3_mint_takes_an_expiry_and_refuses_anything_else` (M3) |
| F-NO-STORE | `Cache-Control: no-store, private` on the JSON, the image `FileResponse`, every 404 and every 429 (`public_note_payload.PUBLIC_HEADERS`). | `test_4_every_public_response_carries_no_store_private` (M6) |
| F-ARCHIVED | `_live_share_row` joins the note and requires `deleted_at IS NULL AND archived_at IS NULL`, for the page AND the image proxy. | `test_7_...` (archived case), `test_note_shares.py` |
| F-EXACT-KEYS | The payload is built by `public_note_payload.public_note`, which returns exactly `PUBLIC_NOTE_KEYS`. | `test_5_the_public_keys_are_exactly_the_note_keys` (M5) |
| F-BODY-LEAKS (a) | A `noteLink` becomes the text "linked note" (ruling D-B7): no id, no title, and so nothing for the public page to fetch with the viewer's cookie. | `tests/test_public_note_payload.py::test_each_type_becomes_what_is_declared[noteLink-*]`, `test_never_other_notes_titles_or_ids` |
| F-BODY-LEAKS (b) | A shown widget keeps only `EMBED_KEPT_ATTRS` and, of `params`, only `EMBED_PARAM_KEYS[widgetId]`; `tradeRef`, `searchText`, `annotations` and `embedId` never leave. A neutral widget leaves nothing but the neutral line. | `test_a_shown_widget_keeps_exactly_what_the_archived_render_reads` (M15) |
| F-BODY-LEAKS (c) | An image (and a figure, a hero, a widget fallback) whose URL still names ANOTHER note's attachment path is dropped. | `test_attachment_urls_of_this_note_are_rewritten_and_other_notes_images_dropped` |
| F-BODY-LEAKS (d) | `attachmentChip` is dropped in both modes. | `test_each_type_becomes_what_is_declared[attachmentChip-*]`, `test_never_file_attachments` |
| F-BODY-LEAKS (e) | `financialFact` becomes a plain paragraph (shown vendors) or the neutral line; `documentExcerpt` is the neutral line (D-B4). No `factId` or `excerptId` leaves. | `test_facts_render_by_vendor` |
| F-BODY-LEAKS (f) | A `link` mark whose href is relative or on our own host loses the link and keeps its words. | `test_internal_link_marks_lose_the_link_and_keep_the_words` |
| F-VENDOR (server half) | The owner's sign-off (L3 + correction) is ONE named table: `MARKET_DATA_VENDORS` (node type and discriminator to vendor) and `VENDOR_VERDICT` (vendor to shown / neutral). Massive-sourced charts and bar widgets are the neutral line on share links and published pages; FMP and Finnhub figures render. Loosening Massive later is one line. | `test_the_owner_sign_off_in_words`, `test_every_registered_widget_has_a_vendor_row` (derived from `registry.js`), `test_every_fact_source_has_a_vendor_row` (M11, M12) |
| F-RATE | Inline limiter hits (ruling D-B10): 60/min per IP on the public read, 240/min per IP on images, 30/hour per member on mint. Over the limit: 429 with one sentence and the public headers. Per-process state, recorded in the report for the CLAUDE.md single-process roster. | `test_6_the_bucket_admits_its_limit_then_answers_429_with_a_sentence` (per-IP and per-member controls; M8) |
| F-PLAN | Mint takes this router's own `require_paid` ("Share links require a paid plan"). Status and revoke do not: a member whose plan lapsed can always see and kill a link. | `test_the_plan_column_is_the_dependency_tree`, `test_10_*` (M9, M10) |
| F-API-HEADERS | `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` on every public API response, hit or miss. | `test_9_every_public_response_carries_no_referrer_and_noindex` |

### 2.2 Still open after B1 + B2

| Finding | Why | Closed by |
|---|---|---|
| F-IN-PAGE-META | the page's own `<meta>` tags are the B3 page change | B3 |
| F-ADMIN-GATE | the editor's controls are the B3 page change | B3 |
| F-READ-WRITES | `notes.get_note` is not lane 8B's file; the write is the owner's own derived column. Recorded, not changed. | open (minor, accepted) |
