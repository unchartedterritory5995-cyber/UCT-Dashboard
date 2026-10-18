# P3a community style library: the arming packet

What this is: everything the owner needs to turn on `NOTEBOOK_STYLE_LIBRARY_ENABLED` after the P3a PR has merged and
`web` is serving it, and to turn it off again. Merging and arming are the owner's. No agent runs a `railway` command.

Status (2026-10-17, branch `notebook-p3a-library`, base `f2e816e042`): built task by task (Tasks 1 to 11), every task
reviewed, then an Opus whole-branch review (0 Critical, 4 Important, 13 Minor), whose one fix round (`fa07acba4d` ..
`cdbbb56ed7`, plus this packet) is in this branch. Nothing here has been run on production.

LANDING: `<LANDING: landing tree sha = this branch + origin/master sha, filled by the controller>`

## What merging does, before anything is armed

Live for every member the moment the PR merges. None of it renders a member-visible change with the switch unset.

1. **The auth payload carries `notebook_style_library_enabled: false`** on signup, login and `/api/auth/me`
   (`api/routers/auth.py:268`, an enablement gate: unset means OFF). Intended.
2. **Every alert id gains a short random suffix, app-wide** (`api/services/alerts.py` `add_alert`, ruling
   P3a-FIN-R2): `type_<ms>` becomes `type_<ms>_<8 hex>`. Two private alerts minted in one millisecond no longer share
   an id, so the second member's durable copy is no longer dropped by `user_alerts`' `INSERT OR IGNORE`
   (OI-P3a-1, closed). Every reader was checked first: only a `startswith` on the S7 prefix and equality lookups;
   none parses the shape. Ids are never shown to a member. Alerts minted before the deploy keep their old ids.
3. **The armed outline gallery's `publish()` mints an author handle row** (`j2_gallery_authors`) for every member
   who shares an outline (`template_gallery.py` `publish`, R-P3-2). The handle is opaque; account deletion clears it.
4. **Every gallery list and item response gains seven keys**: `itemType`, `version`, `tradingStyle`,
   `trendingCount`, `helpfulCount`, `helpedByMe`, `authorHandle` (`template_gallery.py` `_summary`). The author's and
   an admin's reads also gain `sourceStyleId`, `hasRevision` and `revisionTitle`. On an outline item they read
   `outline`, 1, null, 0, 0, false, and the opaque handle (null for a firm item). The contract fixtures were
   re-recorded (`--check`: OK, 293 match).
5. **`?type=style` and `?trading_style=<x>` on `GET /api/j2/template-gallery` answer 400 with the switch off.**
   Before P3a they were unknown parameters, ignored with a 200. No client sends either while the switch is off.
   (The router docstring now says so; it used to say the pod "answers what it answered before".)
6. **Schema at boot, additive and idempotent** (`ensure_gallery_schema`, `db.py` `_PHASE_2_ALTERS`):
   - seven new `j2_template_gallery` columns: `item_type` (default `'outline'`), `payload_json`, `version`
     (default 1), `trading_style`, `source_style_id`, `pending_json`, `pending_at`; and one partial unique index,
     `idx_j2_template_gallery_style_source`;
   - four new tables: `j2_gallery_watches`, `j2_gallery_helpful`, `j2_gallery_authors`, `j2_gallery_follows`, with
     two indexes (`idx_j2_gallery_helpful_user`, `idx_j2_gallery_follows_author`);
   - two new `j2_journal_styles` columns: `source_block_ids`, `source_outline_hash`.
   Every existing gallery row reads as an outline at version 1.
7. **Journal styles (armed since 2026-10-14):** Duplicate now sends `duplicateOf` and the server validates it
   (`journal_styles.create_style`): a `duplicateOf` naming another member's style answers 400. Save-as-style from a
   note reads the note's style provenance (`create_style_from_note`). Both are no-ops until a library row exists.
   `create_style` and `update_style` gained a `commit=` keyword whose default is today's behaviour.
8. **Account deletion** also clears the four new tables (`account_purge.py`; the manifest lists 102 tables), and the
   never-revert rail now covers `j2_gallery_follows` in both directions.
9. **Telemetry:** the server allowlist accepts `library_viewed` and `style_adopted` (enum and bool props only). The
   client sends neither while the switch is off.
10. **Notices:** `lib/notices.js` gains the `library` branch. Inert until a library alert exists.
11. **No scheduler job is added** (`api/main.py` is untouched).

Note: `tools/flow_worker_watch_coverage.py` reports red for this branch (flow-worker runs `alerts.py`, the gallery and
journal-style services, `auth.py` and `journal_two.py`, and watches none of them). That is the review gate the
deploy-windows runbook describes, not a block: no watched file is touched, so flow-worker does not redeploy and the
tape is not bounced. Flow-worker keeps minting `type_<ms>` alert ids until its next deploy; that changes nothing it
does today.

## Dark until the switch is armed

With the switch off the gallery is exactly today's outline gallery. Dark: the Styles and trading-style chips, the
Following view, style cards (Preview, Adopt, Helpful, Report), author pages and Follow, sharing a style (Share to
community in Styles), the Updates list and the previewed update sheet, the library's review details for admins, the
bell's update and withdraw notices, and both telemetry events. Every library route answers the one 404 to a paid
member, an unpaid member and a signed-out caller (`_require_library`, a route dependency ahead of the plan check and
the body; ruling R-T4-2). An author can still unpublish their own item while the switch is off; nobody is rung
(final review M-8).

## Evidence

- **Gate**: `<GATE_RESULT: six shards at the landing tree -- files, totals reconcile, failures outside the baseline
  and whose they are, evidence path; filled by the controller>`
- **Walk**: the style library walk (`tools/notebook_style_library_walk.py`), run 3 on port 8079, 1280 / 820 / 390:
  21 PASS, 0 FAIL, 0 INCONCLUSIVE; `C:\data` CLEAN at every checkpoint of every run
  (`docs/notebook/evidence/p3a-walk-20261017T2219/`; runs 1 and 2 kept raw beside it, and the three integrity logs
  under `docs/plans/joystick/sandbox-runs/2026-10-17T2*.md`). Taken at `7fc99d01b9`, before the fix round.
- **Bytes**, the Notebook first-open closure after the fix round: **2,260,246 B** across 61 chunks (budget file
  2,260,793 B; this branch's ceiling 2,260,316 B). The landing merge with master brings #373's lazy screenshot load,
  about 24 KB lighter. The budget was not raised.
- **The fix round**: see `final-fix-report.md` in the P3a SDD ledger: every new rail mutation-proved red against the
  pre-fix code and restored against the committed blob.
- Known pre-existing reds, not this branch's: `tests/test_notebook_flag_parse.py` (2),
  `tests/test_notebook_switch_rehearsal.py` (NOTEBOOK_TERMINAL_LINKS_ENABLED), `keyListenerCensus` (2),
  `test_user_definitions_auth` (1), `test_address_space` (1).

## Preconditions

- `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` and `NOTEBOOK_JOURNAL_STYLES_ENABLED` are armed (both are today). Adopt also
  needs the journal styles switch; without it adopt answers 409 with its own sentence.
- OI-P3a-1 is in this PR (item 2 above), so no separate hotfix has to land first.

## Arm

```
! railway variables --service web --set "NOTEBOOK_STYLE_LIBRARY_ENABLED=1"
```

No other switch is needed.

## Checks after arming, in order

1. A NEW boot: a startup line stamped after the `--set`. No boot within ~3 minutes:
   `! railway redeploy --service web --yes`.
2. The value in the running process (over `railway ssh` with `/opt/venv/bin/python`), never from `--kv`.
3. `/api/auth/me` for the smoke account carries `notebook_style_library_enabled: true`.
4. The Styles chip and the trading-style chips render in the community gallery, as the smoke account, in its own
   Playwright context (never the owner's Chrome).
5. As the smoke account (an admin, so it can approve): make a style, Share it to the community, approve it in the
   review queue, then Adopt it (leave "Notify me" off). See "Added ... to your styles." and the copy in Styles.
6. Remove what step 5 made, through the product, in this order: Delete the adopted copy
   (`DELETE /api/j2/journal-styles/{copy}`); Unpublish the listing in Your submissions
   (`DELETE /api/j2/template-gallery/{id}`, which also removes its use, watch, Helpful and report rows); Delete the
   source style. Both style deletes are the product's soft delete. The account's opaque author handle row
   (`j2_gallery_authors`) stays: it holds no content, and only account deletion removes it.
7. The app-wide client smoke (R-27): `python tools/hub_nav_smoke.py --auth` (H15 on a measured failure;
   INCONCLUSIVE is not a failure).
8. `docs/feature_flags.json`: move `NOTEBOOK_STYLE_LIBRARY_ENABLED` to `armed` with the flip time, in the same docs
   push.

## Known limits, recorded rather than fixed

- **Multi-hop provenance (ruling P3a-T10-R8).** An adopted copy, a Duplicate of it and a style saved from a note made
  from it all keep their provenance and cannot be shared as the member's own. A longer chain (a note duplicated or
  forked, or a template round trip, then saved as a style) does not carry it, like re-typing a style by hand. Every
  listing is admin-reviewed and the reviewer sees the real content (R1/R7), so review is the backstop.
- **A member with no notes sees library notices only in the AlertBell (ruling P3a-T11-R2).** The bell
  (`/api/alerts`) is the delivery surface; Research Home's Notices box shows them only once a member has notes.
- **Library events are not in the parity scorecard (ruling P3a-T11-R1).** `library_viewed` and `style_adopted` are
  railed where they fire, not added to `CORE_ACTION_EVENTS`. Every gallery open counts one `browse`, whatever the
  member opened it for; read the browse count as gallery opens.
- **No "last updated" date on a style card (final review M-12, ruling P3a-FIN-R3, parked).** No column holds the
  listed version's approval time: `reviewed_at` is also written when a held revision is declined, `updated_at`
  moves when a revision is merely held, and `listed_at` does not move on an approved revision. A column is a
  migration, which the fix round does not add. The card shows "Adopted by N" and no date.
- **Free tags on gallery items are deferred to P3b**, with example notes, because they need the same moderation
  thought.
- Other parked items (the ledger has each): a declined revision has no stale guard (P3a-T4-m4); a removed property
  default is re-added on each update (P3a-T5-m3); a retired block option blocks an apply (P3a-T5-m5); the admin queue
  reads each style row separately (Task 10 M-4); the walk tool's rigour items (Task 11 M1 to M4).

## Roll back

```
! railway variables --service web --set "NOTEBOOK_STYLE_LIBRARY_ENABLED=0"
```

Then verify a NEW boot (as above). The gallery is today's outline gallery again and every library route answers 404.
Adopted styles stay as ordinary styles in each member's Styles, and keep their provenance. Listed style rows,
watches, Helpful votes, follows and handles stay stored and are not read.

**After arming, never roll back by reverting the code while style rows exist (or delete the style rows first).** The
pre-P3a list, review queue and Use have no `item_type` filter, so reverted code would treat every style row as an
outline template: approved styles listed as outlines to every paid member, Use copying a style's outline into Your
templates, and an admin approving a pending style as an outline. The switch is the rollback.

## In-process rate-limit scopes this branch adds (for CLAUDE.md's SINGLE-PROCESS list, in a docs commit)

All in the `api/limiter.py` Limiter's in-memory storage, keyed on the member (`member:<user id>`); the constants are
at the top of `api/routers/notebook_template_gallery.py`. A second web process doubles each one.

| scope | rate | route | durable half |
|---|---|---|---|
| `notebook-gallery-adopt` | 30/hour | `POST /{id}/adopt` | `daily_usage_counters` scope `notebook_gallery_adopt`, 50/day (`NOTEBOOK_GALLERY_ADOPT_DAILY_CAP`); a refused or failed adopt gives the day's charge back |
| `notebook-gallery-helpful` | 60/hour | `POST` and `DELETE /{id}/helpful` (one budget) | none |
| `notebook-gallery-follow` | 60/hour | `POST` and `DELETE /authors/{handle}/follow` (one budget) | none |

Sharing a style (`POST /styles`) spends the existing `notebook-gallery-publish` budget (10/hour, plus its durable
daily cap); it adds no scope. The read routes (the list, an item, the feed, an author page, the updates list and a
plan) are not throttled, like the gallery list.

## Open items

- The plan's Review Focus line for library-off pins cites `test_library_off_hides_every_style_row_and_route`; it is
  renamed `test_library_off_hides_every_style_row_in_the_list` (final review M-11), and its docstring names where the
  route and unpublish-ring rails live.
- The plan's owner decisions were made by the controller under the owner's standing delegation ("you decide it all"):
  every ruling is in the P3a ledger.
