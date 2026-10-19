# P3b example notes: the arming packet

What this is: everything the owner needs to turn on `NOTEBOOK_EXAMPLE_NOTES_ENABLED` after the P3b PR has merged and
`web` is serving it, and to turn it off again. Merging and arming are the owner's. No agent runs a `railway` command.

The switch name is read from the code, not typed from the plan: `EXAMPLE_FLAG = "NOTEBOOK_EXAMPLE_NOTES_ENABLED"`
(`api/services/journal_two/template_gallery.py:83`), and the flag ledger entry of the same name
(`docs/feature_flags.json`, status `dark`, where `web`).

Status (2026-10-18, branch `notebook-p3b-examples`): built task by task (Tasks 1 to 8), every task reviewed, then an
Opus whole-branch review (1 Critical, 0 Important, 7 Minor) and its fix round (`3c3394fcec` .. `13ae545dba`), a scoped
re-review (1 new Critical, 3 Minor) and its targeted fix (`3b5fe61557`, `30123ca6ae`), all in this branch. Nothing here
has been run on production.

LANDING: final tree `542664aea1` (this branch + origin/master `6d03c64610`); the gate of record ran at `984b6329d2` = this branch (with the three landing-gate fixes, `152cf41114`, `95527431c6`, `7268de9551`) +
origin/master `f202ff9c48`, merged cleanly (fourth landing pass; no conflicts). Every evidence line below is at that
tree unless it says otherwise.

## What merging does, before anything is armed

Live for every member the moment the PR merges. With the switch unset none of it renders a member-visible change.

1. **The community gallery list response gains one key:** `capabilities: {exampleNotes: false}`
   (`api/routers/notebook_template_gallery.py:244`). It is read by the lazy library UI only; with `false` the
   "Add an example note" door does not render. The list fixture was re-recorded (`--check`: OK, 322 match).
2. **Every example route answers the gallery's one 404**, ahead of the session, the plan and the body
   (`_require_example`, a route dependency): `POST /api/j2/template-gallery/examples/preview`,
   `POST /api/j2/template-gallery/examples` and `GET /api/j2/template-gallery/{id}/images/{n}`. An `example_note` row
   reads as absent everywhere while the switch is off (no rows exist yet in any case).
3. **Schema at boot, additive and idempotent** (`ensure_gallery_schema`): one new `j2_template_gallery` column,
   `source_note_id TEXT`, and one partial index, `idx_j2_template_gallery_note_source`. No table is added. Existing
   rows read `source_note_id` NULL.
4. **Report and reject, for styles and outlines too (the shared path):**
   - a report is gated by the same visibility check as a read (`_can_see`, ruling P3b-F-R2): reporting an item you
     cannot see answers the not-found;
   - an admin reject takes `reviewedUpdatedAt` and answers 409 on a mismatch (P3b-F-R4), with a sentence telling the
     admin to reload the queue (P3b-F2-R3). The admin review card sends it.
   These touch the armed P3a library and outline gallery. Neither changes anything for a member.
5. **A style read always carries `examples`** (`[]` when there are none) while the switch is ON; with it off the key
   is absent (P3b-T6-R1). Three style-item fixtures gained the key in the on-state recording.
6. **Account deletion** also removes a member's example-note image copies under `<attachment_root>/gallery/<item_id>/`,
   the ids read inside the deletes' own write transaction (P3b-F-R3). The deletion manifest names the directory.
   A no-op until an example exists.
7. **Small shared fixes:** `author_handle` ends the failed insert's transaction before re-reading (P3b-T3-R3);
   `document_extraction` exports its two status names (`STATUS_PENDING`, `STATUS_FAILED`) as the same values.
8. **No scheduler job, no client flag row, no first-open bytes** (`FLAG_FALLBACKS` untouched, ruling R-P3b-6;
   `api/main.py` untouched).

Note: no new table means `account_purge.py`'s table manifest is unchanged; the image directories are the new
deletion surface (item 6).

## Dark until the switch is armed

With the switch off the library is exactly the armed P3a library. Dark: the "Add an example note" door in Share to
community and on a style's own page, the note picker, the preview sheet (counts by kind, each replaced span
highlighted, images off by default with their OCR state and the second confirm), publishing an example, the "In use"
section on a style card, the example image route, and an author's examples in Your submissions.

## Evidence

- **Gate of record**, six shards, at the landing tree `984b6329d2`: 3,582 test files, totals reconcile, 16 NEW against
  the baseline, **none of them this branch's**. 13 are red alone on master `f202ff9c48` with identical failure text
  (StockChart.focusWarmStep, enumerationSites, lwcHazards, panelAdoption.ratchet, handRolledFormatters.census,
  keyListenerCensus x2, offlineNeverStoresComputed x2, terminalReachableContrast x3, themeColours.rail); 3 pass alone
  (objectLaneCallSites.measure, objectLaneDrawerCensus.measure, ScanObjectCard), so load-sensitive. Evidence:
  `docs/notebook/evidence/p3b-gate-landing2-20261019T0035/`. The first landing gate (`616097eb78`) found three of this
  branch's reds, fixed under rulings P3b-T9-G1, G2/G2b and G3 (`docs/notebook/evidence/p3b-gate-landing-20261018T1755/`).
- **Carry-over** `984b6329d2` -> the final landing tree `542664aea1` (origin/master `6d03c64610` merged, 19 incoming
  `app/src` files, none this branch's): C0 misses structurally (`app/src` is a whole-directory entry), C1, C2 and C3
  pass, so it CARRIES (ruling P3b-T9-R7). C4 on `542664aea1`: vitest 15 files, 183 passed; pytest 1,364 passed,
  2 skipped, including `tests/test_gate_shards.py` after R4 added the three P3b paths to `GATE_READ_PATHS`.
  Evidence: `docs/notebook/evidence/p3b-gate-landing2-20261019T0035/`.
- **Landing rails** (30 pytest files: the P3b and P3a library tests, the reducer, import closure, account purge,
  flag/ledger/rehearsal/rollback, contract fixtures, hygiene): 2,115 passed, 6 failed, every one a known base red by
  name (`test_notebook_flag_parse` x2, `test_notebook_switch_rehearsal` on `NOTEBOOK_TERMINAL_LINKS_ENABLED`,
  `test_address_space` on `agent_conversations` and master's new `tsdr_lessons`, `test_user_definitions_auth` on a
  duplicated screener sentence, `test_notebook_bridges_pin_the_root` on `tools/notebook_daily_prep_probe.py`).
  Contract fixtures `--check`: OK, 322. `docs/notebook/evidence/p3b-landing-20261018T233452Z/` (the same 6 named reds
  as the previous pass).
- **Bytes** at the landing tree: **2,239,350 B** across 61 chunks, PASS, against **2,239,362 B** for master `f202ff9c48`
  built and measured the same way: this branch is -12 B on first open. The ceiling is the budget file, **2,260,793 B**,
  not raised.
- **Walk of record**: `tools/notebook_example_notes_walk.py`, 1280 / 820 / 390: 21 PASS, 0 FAIL, 0 INCONCLUSIVE,
  `C:\data` CLEAN (`docs/notebook/evidence/p3b-walk-20261018T122859Z/`), at `8762d9a406`, before the final fix
  rounds. The earlier walk `p3b-walk-20261018T121236Z` (18/3/0) found the fail-open OCR step that `8e4dedc998` fixed.
- **The fix rounds**: `final-fix-report.md` in the P3b SDD ledger. Worst-case preview at 200 KB after the fix:
  2.9 s on the request (was ~41 min), 2.16 s on the threadpool; every new rail mutation-proved red against the
  pre-fix code.

## Preconditions

- `NOTEBOOK_STYLE_LIBRARY_ENABLED` is armed (the ledger: ARMED on web 2026-10-18 10:17 CT), and with it
  `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` and `NOTEBOOK_JOURNAL_STYLES_ENABLED`. Example notes need the library switch:
  with it off every example route 404s whatever this switch says (`example_enabled()` reads both, per call).
- `J2_OCR_ENABLED` decides whether an image's OCR state can be `ready`. Without an engine every image reads
  `unavailable` and carries the second confirm (fail closed, ruling P3b-T8-R1). Arming does not depend on it.

## Arm

```
! railway variables --service web --set "NOTEBOOK_EXAMPLE_NOTES_ENABLED=1"
```

No other switch is needed.

## Checks after arming, in order

1. A NEW boot: a startup line stamped after the `--set`. No boot within ~3 minutes:
   `! railway redeploy --service web --yes`.
2. The value in the running process (over `railway ssh` with `/opt/venv/bin/python`), never from `--kv`: read
   `NOTEBOOK_EXAMPLE_NOTES_ENABLED` and `NOTEBOOK_STYLE_LIBRARY_ENABLED` in the same call.
3. **The list shows the capability.** As the smoke account, in its own Playwright context (never the owner's
   Chrome): `GET /api/j2/template-gallery` answers `capabilities.exampleNotes: true`.
4. **A preview shows one money change.** As the smoke account: create a note whose body is the one line
   `Risked $100 on the plan.` (`POST /api/j2/notes`), then
   `POST /api/j2/template-gallery/examples/preview` with `{"noteId": "<id>"}`. Expect 200, `counts == {"money": 1}`,
   one entry in `changes` (`kind: "money"`, `after: "your value here"`), and `your value here` in `bodyJson` where
   `$100` was.
5. **It does not submit.** Do not call `POST /api/j2/template-gallery/examples`. Confirm the preview wrote nothing:
   `GET /api/j2/template-gallery?section=mine` lists no `example_note` row for the smoke account.
6. **Nothing is left behind.** Trash the note through the product (`DELETE /api/j2/notes/{id}`, the soft delete), and
   confirm it is gone from the live list. A preview stores no row and copies no image, so nothing else exists to
   remove. The one preview spent one of the account's 60 per hour (`notebook-gallery-preview`, in-process), which
   expires on its own.
7. The app-wide client smoke (R-27): `python tools/hub_nav_smoke.py --auth` (H15 on a measured failure;
   INCONCLUSIVE is not a failure).
8. `docs/feature_flags.json`: move `NOTEBOOK_EXAMPLE_NOTES_ENABLED` to `armed` with the flip time, in the same docs
   push.

## Roll back

```
! railway variables --service web --set "NOTEBOOK_EXAMPLE_NOTES_ENABLED=0"
```

Then verify a NEW boot (as above). The door, the preview and the In use section disappear, every example route
answers 404, and `capabilities.exampleNotes` reads `false`. Stored examples and their image copies stay stored and
unlisted; withdrawing a style or deleting an account still removes its examples' copies.

**After arming, never roll back by reverting the code while example rows exist (or delete them first).** The
pre-P3b code does not know `item_type = 'example_note'`: with the library armed, master's `list_gallery` adds no
`item_type` filter when none is asked (`template_gallery.py` at `origin/master`, the `elif item_type:` branch), so an
approved example would be listed on its own to every paid member, and its image copies would be left with no route
and no purge. The switch is the rollback.

## In-process rate-limit scopes this branch adds (CLAUDE.md's SINGLE-PROCESS list)

Already added to CLAUDE.md in this branch (the final fix round, P3b-F-R1); no further docs commit is owed.

| scope | rate | route | durable half |
|---|---|---|---|
| `notebook-gallery-preview` | 60/hour, keyed `member:<user id>` | `POST /examples/preview` (a full preview; `titleOnly: true` is not charged, ruling P3b-F2-R5) | none: a preview writes nothing and is not a charge |

Publishing an example (`POST /examples`) spends the existing `notebook-gallery-publish` budget (10/hour, plus its
durable 10/day; R-P3b-8); it adds no scope. The image route is not throttled, like the gallery reads. A second web
process doubles the preview scope.

## Known limits, recorded rather than fixed

- **Prices without a `$` stay** ("NVDA 132.40", R-P3b-3): a level in a plan is the example's point, and the author
  sees it in the preview. The preview and the admin review are the backstop for any pattern the scrub misses.
- **A raw title over 2,000 characters answers 400** (P3b-F2-R1); only a hand-built API call reaches it (the field caps
  at 80, note titles at 300).
- **The OCR "yet" sentence is shown for `unavailable` too** (P3b-T8-R2, OI-P3b-27): it tells the member to check the
  image themselves either way.
- **Parked in the ledger** (`OI-P3b-*`): no fixture for the `?rev=pending` image route (OI-P3b-26); the walk's step 4
  does not pin `J2_OCR_ENABLED` unset (OI-P3b-28); the Task 5 picker minors (OI-P3b-18 to 21); the feed and author
  page audit for example rows (OI-P3b-24, addressed by the final review's R6 helper).

## Open items

- The plan's owner decisions were made by the controller under the owner's standing delegation ("you decide it all"):
  every ruling is in the P3b ledger (`progress.md`) and listed in the PR body.
