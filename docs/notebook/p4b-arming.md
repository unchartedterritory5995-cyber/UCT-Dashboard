# P4b layout sharing: the arming packet

What this is: everything the owner needs to turn on `NOTEBOOK_LAYOUT_SHARING_ENABLED` after the P4b PR has merged and
`web` is serving it, and to turn it off again. Merging and arming are the owner's. No agent runs a `railway` command.

The switch name is read from the code, not typed from the plan: `LAYOUT_SHARING_FLAG = "NOTEBOOK_LAYOUT_SHARING_ENABLED"`
(`api/services/journal_two/template_gallery.py:173`), and the flag ledger entry of the same name
(`docs/feature_flags.json`, status `dark`, where `web`). It is **server-only**: there is no auth payload key and no
client fallback row (R-P4b-10). The client learns it from the library list's `capabilities.layoutSharing`, and
`GET /api/j2/template-gallery/layouts/status` answers 404 while it is off. It is read per call with a plain
`os.environ.get`; unset or any unrecognised value is OFF.

Status (2026-10-19, branch `notebook-p4b-layout-sharing`): built task by task (Tasks 1 to 9 and 6b), every task
reviewed, an Opus whole-branch review (0 branch Critical or Important; 5 silent merge hazards) and its two-part fix
(part (a) `60015f25dc..2ef3f07519`; part (b), the merge of origin/master `c03b7473dd` with P3b and P5 in it as
`b50967c1f7`, then `3b03209956..0ef00ed11e`). Nothing here has been run on production.

LANDING: the PR head. Its code tree was gated at `0ef00ed11e`. origin/master did not move after that (`c03b7473dd`
is an ancestor), so there was no further merge. Every commit after `0ef00ed11e` is docs or evidence only, and
carry-over says CARRIES (C0 IDENTICAL).

## The four switches (P4b-R-X14, P4b-R-T2-2)

`layout_sharing_enabled()` is the library switch AND the page-layouts switch AND this one, read per call. The
template-gallery switch is the router's own dependency, so every layout route sits behind it too.

| switch | role | state on `web` (ledger) |
|---|---|---|
| `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` | the gallery router; off means every gallery route 404s | **armed** 2026-10-08 ~00:30 CT |
| `NOTEBOOK_STYLE_LIBRARY_ENABLED` | the community library (P3a) | **armed** 2026-10-18 10:17 CT |
| `JOURNAL_PAGE_LAYOUTS_ENABLED` | page layouts and Customize | **armed** 2026-10-18 10:08 CT |
| `NOTEBOOK_LAYOUT_SHARING_ENABLED` | this packet | **dark** (unset) |

## Preconditions (O-P4b-1)

The first three switches above are armed and verified in the running process **before** this one is set. They are
already armed on `web` per the ledger; re-read them in-process (check 2 below) rather than trusting the ledger, which
records intent and cannot see Railway.

## What merging does, before anything is armed

The layout-sharing switch stays unset at merge. With it unset, every layout route answers 404, layout items read as
absent in every gallery read, and the Page layouts chip does not show (P4b-R-T3-2, railed). Three things still change
for members and admins the moment the PR merges, because they ride switches that are already armed:

1. **One member-visible sentence: the adopt cap.** When a member hits the durable daily adopt cap
   (`notebook-gallery-adopt`), the answer was "You've adopted a lot of styles today. Try again later." It is now
   "You've adopted a lot from the library today. Try again later." (`ADOPT_RATE_SENTENCE`,
   `api/routers/notebook_template_gallery.py:102`; P4b-T5-R1). The cap is shared by styles and layouts, so the
   sentence no longer names styles. Seen only by a member who reaches the cap.
2. **One 404ing status read per Customize open.** `PageLayoutEditor` calls `useLayoutSharingStatus()`, which reads
   `GET /api/j2/template-gallery/layouts/status` when Customize opens. With the switch unset that read answers 404,
   and the editor treats the 404 as "sharing is off" through an explicit 404 branch, never a swallowed error
   (P4b-R-X12, the swallowed-fetch census). No sentence is shown and nothing breaks. Expect one 404 per Customize
   open in the access log until arming.
3. **Admin Feature/Hide on layout cards.** `LayoutLibraryCard` renders `GalleryAdminActions` for admins (P4b final
   I-M1). No layout card can be seen while the switch is unset, so nobody sees these controls yet.

Dark until the switch is armed: the Page layouts chip, Share this layout in Customize, the layout preview and the
Use this layout sheet, `POST /layouts`, `GET /layouts/status`, `POST /{id}/adopt-layout`, and every layout item.

## Arm

```
! railway variables --service web --set "NOTEBOOK_LAYOUT_SHARING_ENABLED=1"
```

No other switch is needed. The three preconditions are already armed.

## Checks after arming, in order

Run checks 3 to 9 as the smoke account (`smoke@uctintelligence.internal`, an admin) in its OWN Playwright context,
never the owner's Chrome. Before acting, read `/api/auth/me` and confirm the email is the smoke account's.

1. **A NEW boot**: a startup line stamped after the `--set`. No boot within ~3 minutes:
   `! railway redeploy --service web --yes`.
2. **The values in the running process** (over `railway ssh` with `/opt/venv/bin/python`), never from `--kv`: read
   `NOTEBOOK_LAYOUT_SHARING_ENABLED`, `NOTEBOOK_STYLE_LIBRARY_ENABLED`, `JOURNAL_PAGE_LAYOUTS_ENABLED` and
   `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` in one call. All four must read on.
3. **The capability.** `GET /api/j2/template-gallery` answers `capabilities.layoutSharing: true`, and
   `GET /api/j2/template-gallery/layouts/status` answers 200 (no longer 404).
4. **The chip.** Open the library (Styles manager > Community): the **Page layouts** chip shows beside All.
5. **Publish from the smoke account's own Today.** First record the smoke account's stored `journal_page_layout`
   preference (`GET /api/auth/preferences`), so it can be compared at the end. Open Today > Customize > Share this
   layout and share it. Expect a pending item: the form says it waits for review, and the item does not list in the
   library for other members (`GET /api/j2/template-gallery?type=page_layout` as the smoke account shows it only as
   its own pending item, or not at all).
6. **An admin approves it.** The smoke account is an admin. In the review panel (Styles manager > Community > Review
   queue), approve the layout. The approval carries `reviewedUpdatedAt`; a 409 means the item changed since it was
   read, so re-open the queue and approve again. The item now lists under Page layouts.
7. **Adopt, then Undo, on the smoke account.** Open the listed layout, preview it, press Use this layout, then Undo.
   The page must show the same panels in the same order, shown and hidden as before. Adopting your own item records
   no use and spends one adopt from the account's daily budget (`_record_use` skips the author). ⚠️ Known limit
   below: if the smoke account had NO stored `journal_page_layout` before step 5, Undo writes explicit default lists
   where nothing was stored. The page looks identical; the stored preference is not. In that case press
   Customize > **Reset to default** for Today and Save, then compare the stored preference with the one recorded in
   step 5.
8. **Nothing is left behind.** Unpublish the layout through the product (the item's own Unpublish, which is
   `DELETE /api/j2/template-gallery/{id}`). The library says it was unpublished, the item no longer lists, and the
   smoke account's Today is unchanged (an adopted layout is the member's own; withdrawing changes nothing adopted).
   The stored `journal_page_layout` must match what step 5 recorded.
9. **The app-wide client smoke** (R-27): `python tools/hub_nav_smoke.py --auth`. A measured failure is H15: roll back
   first, then report. INCONCLUSIVE is not a failure.
10. `docs/feature_flags.json`: move `NOTEBOOK_LAYOUT_SHARING_ENABLED` to `armed` with the flip time, in the same docs
    push that records the flip.

## Roll back

```
! railway variables --service web --set "NOTEBOOK_LAYOUT_SHARING_ENABLED=0"
```

Then verify a NEW boot, as above. Every layout route answers 404 on the next request, layout items read as absent,
and the Page layouts chip and Share this layout go on the member's next reload of the library or Customize. No
redeploy. Nothing is deleted: layouts members already adopted stay in their own `journal_page_layout` preference,
and shared layout items stay stored and unread.

## Known limits (follow-ups, not blockers)

- **Undo writes explicit default lists where none were stored** (Task 9 review Minor 1, follow-up). A member who
  never customized a page, adopts a layout, then presses Undo gets the default panel lists written out explicitly
  instead of no stored list. The page renders the same today. The difference shows only when a later release adds a
  panel in the middle of the registry: an absent list places it where the registry puts it, an explicit list
  appends it at the end.
- **The Reported card shows the listed version** (ruling P4b-FIN-R2). In the review panel, a reported layout is shown
  as the version members saw (the listed one), not a held revision, because a report is about what members saw.

## In-process rate-limit scopes this branch adds (CLAUDE.md's SINGLE-PROCESS list)

None new. Sharing a layout spends the existing `notebook-gallery-publish` scope (10/hour, durable daily half), and
adopting one spends the existing `notebook-gallery-adopt` scope (30/hour, durable 50/day), both already in the list.

## Evidence

All in `docs/notebook/evidence/p4b-gate-landing-20261019T0749/`.

- **Gate of record:** `2026-10-19T03-39-03.{json,md}` at `0ef00ed11e` (raw manifest committed first, `c2c69d2c17`).
  - Result: 14 NEW, 3,599 test files, totals reconcile, the tree head the same at both ends.
  - Classified in `classification.md` (`1cda32730c`), each file run alone on the branch and on origin/master
    `c03b7473dd`: **0 this branch's**, 13 master's (the same 13 names P5's landing gate classified as master's),
    1 load-sensitive (`ScanObjectCard.test.jsx`, passes alone on both). Raw logs `alone-branch-0ef00ed11e.log`
    and `alone-master-c03b7473dd.log`.
- **Carry-over and C4 on the landing tree:** `0ef00ed11e` -> `1cda32730c` against origin/master `c03b7473dd`.
  Result: **CARRIES** (C0 IDENTICAL over `GATE_READ_PATHS`). Evidence `carry-over-1cda32730c.txt`.
  - C4 vitest: 13 files, 267 passed (`c4-vitest-1cda32730c.txt`).
  - C4 pytest: 603 passed, 2 skipped (both opt-in rails in `test_gate_shards.py`), 0 failed
    (`c4-pytest-1cda32730c.txt`).
- **Bytes (final tree):** `bytes.notebook_first_open` is 2,240,993 B on the landing tree and 2,240,572 B on
  origin/master `c03b7473dd`, both built and measured the same way with `tools/notebook_perf_budgets.py`. The delta
  is **+421 B**. The budget file's ceiling, 2,260,793 B, was not raised. Evidence `bytes-1cda32730c.txt`.
- **Earlier landing rails** (part (b), on `0ef00ed11e`): pytest 1,989 passed + 7 known base reds; vitest 580
  passed + 2 `keyListenerCensus` base reds. See `.superpowers/sdd/2026-10-18-notebook-p4b-layout-sharing/
  final-fix-b-report.md` in the spec worktree (the ledger is local).
- **The walk** (Task 9): `tools/notebook_layout_library_walk.py`, run 2 21/0/0 three times, raw evidence committed
  in `60015f25dc`.
