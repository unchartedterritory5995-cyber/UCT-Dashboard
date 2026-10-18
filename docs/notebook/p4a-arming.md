# P4a page layouts: the arming packet

What this is: everything the owner needs to turn on `JOURNAL_PAGE_LAYOUTS_ENABLED` after the P4a PR has merged and
`web` is serving it, and to turn it off again. Merging and arming are the owner's. No agent runs a `railway` command.

Status (2026-10-17, landing tree `cb4482ba96` = this branch + master `0dc4e8448a`, which includes #372 and #373): built task by task, every task
reviewed, then an Opus whole-branch review (0 Critical, 2 Important, 7 Minor), whose fix wave (`c629efe0ac` ..
`d1aa9fe608`) is in this branch. Gated, walked and measured at the landing tree (below). Nothing here has been run on
production.

## What merging does, before anything is armed

Live for every member the moment the PR merges:

- **The day-notes fix** (`ec29d584d9`, the same change as PR #372, which is already live in production since
  2026-10-17; merging this PR changes nothing further there). Before it,
  every day-page save sent only the checklist, the attachments and the rules, and the server read the missing prep,
  mid-day and recap fields as empty and replaced the row, so those notes never kept an edit. The server now keeps any
  field a save leaves out.
- **`upsert_day_notes` reads and writes in one `BEGIN IMMEDIATE` transaction** (`d1aa9fe608`), so two saves of the same
  day from two tabs cannot interleave between the read of the kept fields and the write.
- **Today's post-close header wraps on a phone** (`4afab4b9b1`): at 390 px the "Reflect on today" button no longer
  runs off the screen.
- `usePreferences` gains a `readFailed` field. No existing caller reads it; nothing a member sees changes.

Dark until the switch is armed: the Customize button on Today and on the trade page, the layout editor, reading a
saved layout, the five Today panels (checklist, my rules, the regime card, today's note, notices) and the stand-alone
discipline-lock notice. With the switch off both pages render exactly their pre-P4a layout; the trade page's
save-error line sits where it always did (ruling P4a-T9-R1 / R4, railed).

## Evidence

- **Gate**, six shards, at the landing tree `cb4482ba96`: 3,542 test files, totals reconcile, and 11 failures
  outside the 2026-09-24 baseline, none of them this branch's. Eight fail identically on master
  alone: the seven below, plus `StockChart.smoke` (`onDrawnBarCount`, on master `ba78049553`). The other three
  (`vendorHarness.coverageAudit`, `pineStrictCensus`, `BarReplay.theme`) pass on master alone and on
  this landing tree alone, so they were load-sensitive while other work shared the machine.
  Evidence: `docs/notebook/evidence/p4a-walk-20261018T013400Z/landing/`. An earlier gate at
  `fed96d5d32` (master `c497cfa400`) reported 7 failures outside its 2026-09-24 baseline; all 7 fail
  identically on master `c497cfa400` alone and sit in files this branch does not touch, so none
  is this branch's. The landing merge then touched `docs/feature_flags.json`, so carry-over did not
  hold and the gate was re-run.
- **Walk**, the finish walk's `page_layouts` group, sandbox c2, 1280 / 820 / 390, at the landing tree `cb4482ba96`: **27 steps, 0 FAIL** (26 PASS and
  1 INFO, the parked null Suspense fallback while the editor chunk loads), sandbox integrity CLEAN at
  every checkpoint, 62 db files hashed (`docs/notebook/evidence/p4a-walk-20261018T013400Z/c2/`). No
  overflow flag at 390.
  The Task 8 walk at `b1a8a92d78` was 27 steps, 0 FAIL, sandbox CLEAN, and found the 390 px overflow fixed above
  (`docs/notebook/evidence/p4a-walk-20261017T155727Z/`, `p4a-walk-20261017T160435Z/`).
- **Bytes**, the Notebook first-open closure at the landing tree `cb4482ba96`: **2,236,245 B** across 60
  chunks against the 2,260,793 B budget, PASS, 24,548 B of headroom (#373's lazy screenshot load is
  in this tree). Before #373 the branch measured 2,260,701 B. The budget was not raised.
- **The fix wave**: vitest 24 named files, 326 passed; pytest 4 named files, 141 passed; every new rail mutation-proved
  red and restored by sha (`.superpowers` ledger, final-fix-report).
- Known pre-existing reds on master, not this branch's: `tests/test_notebook_flag_parse.py` (2),
  `tests/test_notebook_switch_rehearsal.py` (NOTEBOOK_TERMINAL_LINKS_ENABLED), `keyListenerCensus` (2),
  `test_user_definitions_auth` (1), `test_address_space` (1).

## Arm

```
! railway variables --service web --set "JOURNAL_PAGE_LAYOUTS_ENABLED=1"
```

No other switch is needed: the panels import no flags of their own.

## Checks after arming, in order

1. A NEW boot: a startup line stamped after the `--set`. No boot within ~3 minutes:
   `! railway redeploy --service web --yes`.
2. The value in the running process (over `railway ssh` with `/opt/venv/bin/python`), never from `--kv`.
3. `/api/auth/me` for the smoke account carries `journal_page_layouts_enabled: true`.
4. Customize renders on Today and on a trade page, as the smoke account, in its own Playwright context (never the
   owner's Chrome).
5. As the smoke account: hide one Today panel and move another, Save, reload, and see the saved order. Then Reset
   through the product (the editor's Reset, then Save), reload, and see the default order. The smoke account ends
   with no saved layout.
6. The app-wide client smoke (R-27): `python tools/hub_nav_smoke.py --auth` (0 PASS, 1 measured, 2 INCONCLUSIVE; H15
   on 1).
7. `docs/feature_flags.json`: move `JOURNAL_PAGE_LAYOUTS_ENABLED` to `armed` with the flip time, in the same docs push.

## What not to expect

- No grid, no drag and drop: panels are shown or hidden with a toggle and moved with up and down buttons.
- No phases on the trade page: per-session-phase layouts are Today's only (ruling R-P4-5).
- No sharing of a layout: that is P4b.
- On a phone the pages stay one column; the editor opens as a sheet.
- Customize is not offered on Today's zero-data screen, where no choice would show.

## Known limits, recorded rather than fixed

- **A tick sends this tab's rules list.** The checklist panel sends only `rules` (never the narrative), but the list is
  the open tab's copy, so a tick on an hours-old Today tab can write its rules over rules ticked elsewhere. That is the
  whole-list rules field's nature, as on the day page.
- **The day page's own checklist and attachment saves still send their full bundle.** Safe since the day-notes fix
  (the server keeps what is left out); not changed here.
- **The editor refuses to save after any failed preferences read**, including a revalidation that failed after an
  earlier read succeeded. It over-refuses rather than risk writing defaults over a member's other lists; a reload
  clears it.
- **A refused save can show the new layout for a moment** (the shared optimistic preference write; ruling
  P4a-T7-R1). A refusal needs a malformed blob the server's shape check rejects.
- **Members can hide the coach strip.** An active discipline lock still shows: with the strip hidden, Today renders
  the lock rows on their own (ruling P4a-T9-R2).

## Roll back

```
! railway variables --service web --set "JOURNAL_PAGE_LAYOUTS_ENABLED=0"
```

Then verify a NEW boot (as above). Both pages render their fixed layouts again. Saved layouts stay stored in
`journal_page_layout` and are not read. The day-notes fix, the transaction and the phone wrap are removed only by
reverting the PR, and none of them should be: they fix live defects.

## Open items

- Parked from the final review: m2 (`refreshPreferences()` after a failed save resets the tab's revision baseline; no
  harm found).
- The plan's owner decisions were made by the controller under the owner's standing delegation ("you decide it all"):
  every ruling is in the P4a ledger.
