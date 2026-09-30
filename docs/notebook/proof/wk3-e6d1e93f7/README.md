# Notebook wave 10 -- the proof instruments' evidence (lane WK3)

Raw records are committed BEFORE this interpretation (R-RAW). Every number below cites the raw
file it was read from. This lane's mandate: make `tools/notebook_proof_walk.py` produce VALID
readings for clauses 9a, 2c, 5d, 6c, 2b, then run it on the tip and report honestly. WK2 (landed
in L7, #254) had already fixed the root cause named in `docs/notebook/proof/wk-7bd834b9f/README.md`
-- `MARK_ROOT_JS` marking the skip link's TARGET instead of its portaled parent -- and wired
`open_more_note_actions()`/`open_format_more()` into most of the census/axe/silent/geometry
call sites this lane's brief listed as still-open defects. **Verified, not assumed**: this
lane's own live run confirms every one of those WK2 fixes actually holds, found one residual
gap WK2 missed (three of `5d`'s write doors), fixed it, and -- via a controller note mid-run
from lane FX -- fixed two further geometry-instrument defects (an occluder mislabel and an
"at rest" scroll semantics bug) before the geometry sweep's evidence was accepted.

## Instrument fixes landed in this lane (all on `feat/notebook-w10-wk3`)

| commit | fix | rail | mutation result |
|---|---|---|---|
| `aad774653` | 5d: `lock`/`archive`/`save-template` write actions never opened the editor's "More note actions" menu before pressing the button (`surface_by_id("nb-note").open()` is `s_note`, which never opens it) -- exactly 3 of WK's "5 write doors UNREACHED". Added `_act_more_menu_click()`. | `test_lock_archive_and_save_template_writes_open_the_more_menu_first` | reverted the 3 call sites to `_act_click` -> RED; restored via `os.replace` from captured bytes, sha256 verified; suite 28->29 |
| `d5ca882b9` | Environment: this worktree's `app/node_modules` junction (into `notebook-k`, transitively `notebook-w8`'s real install) has no `axe-core` at all -- `run_sweeps` read `axe.min.js` unconditionally before seeding, so EVERY sweep failed before a single control ran (walk exited 3). Added `NOTEBOOK_PROOF_WALK_AXE_CORE` env override (unset = byte-identical old path); vendored copy lives in this lane's own scratchpad, never committed, never written into any shared directory (writing into the junction's target was refused by the session's own permission layer as a shared-resource modification). | `test_axe_core_path_defaults_to_the_pinned_junction_path_and_can_be_overridden` | dropped the override branch -> RED; restored, sha256 verified; suite 29->30 |
| `a05944039` | 6c, fix 1 (occluder mislabel, found live by lane FX): `hit.closest('...,section,aside,div')` could climb from a non-div hit (e.g. MobileNav's `<header>`) past every intervening div to a full-viewport app-shell wrapper, and `desc()`'s `.innerText` read a portaled skip link's own (off-screen) text first -- blaming the skip link for occlusions it never causes. Fix: `tightOccluderAncestor()` rejects a candidate ancestor whose own bounding box is (near-)viewport-spanning (>85% of vw×vh). <br> 6c, fix 2 ("at rest" semantics, lane FX): a control under FIXED/STICKY chrome mid-scroll always read occluded even when scrolling it clear would resolve it. Fix: `canEscapeByScroll()` + a per-control `scrollIntoView({block:'center'})` re-test, restored immediately after each check. | `test_the_geometry_control_requires_the_mislabel_and_restscroll_plants` | dropped the 3 new required keys from `control_ok`'s "geometry" branch -> RED; restored, sha256 verified; suite 30->31 | 
| `e6d1e93f7` | The `plant-scroll-clear` fixture itself was wrong: its target sat 8px from the top of a 452px scrollable panel, so `block:'center'`'s ideal scrollTop was negative and clamped to 0 -- the browser never moved it. Found live: the FIRST geometry-only re-run (port 8329) read `[INVALID] geometry control: plant-scroll-clear: got 'OCCLUDED', must be 'CLEAR'`. Fixed with 280px of spacer on both sides + an explicit initial `scrollTop`. | (fixture only; no new pure-Python assertion -- verified by the SECOND geometry-only re-run reading VALID, see below) | n/a -- browser-fixture change, verified live |

`python tools/notebook_proof_walk.py --self-check`: 12/12 ok, exit 0 (unaffected by any of the
above -- self-check exercises the judge functions and pure `control_ok`, not `run_sweeps`/`GEOM_JS`).
`python -m pytest tests/test_notebook_proof_walk.py -q`: **31 passed** (was 28 at dispatch).

## What ran, on what

Two runs back this README, both on the tip that includes every fix above (`e6d1e93f7a203ce442cb905072da604d925b8355`).
Census, axe, silent and deadclick ran together on `feat/notebook-w10-wk3` at `d5ca882b9` (the tip
BEFORE the two geometry-instrument fixes, which touch nothing outside `GEOM_JS`/the geometry
control -- census/axe/silent/deadclick's own code is byte-identical between `d5ca882b9` and
`e6d1e93f7`, so their readings are unaffected by the two commits that came after). Geometry was
re-measured in isolation at `e6d1e93f7` once its control read VALID.

| | census / axe / silent / deadclick | geometry |
|---|---|---|
| tip measured | `d5ca882b94c6c73156166cf6198327540497193a` | `e6d1e93f7a203ce442cb905072da604d925b8355` |
| sandbox | `<scratchpad>\wk3-data`, port 8319 | `<scratchpad>\wk3-geo-data`, port 8329 |
| record | `docs/notebook/proof/wk3-d5ca882b9/{run.json,census.json,axe.json,silent.json,deadclick.json,integrity.md,HUNG-deadclick.md}` (this run's own `geometry.json`, pre-fix, is NOT committed -- 5.3 MB, over the repo's 5 MB limit, and fully superseded; see `geometry-SUPERSEDED.md` in that directory) | `docs/notebook/proof/wk3-e6d1e93f7-geo/{run.json,geometry.json,integrity.md}` |
| sandbox integrity | **INCOMPLETE** -- pre-boot/post-boot(+15s)/post-prewarm(+120s) CLEAN, 62 db files hashed each time; **no shutdown checkpoint** (see below) | **CLEAN** at all four checkpoints, 62 db files hashed each time, `stop: "graceful (rc 0)"` |
| self-check | `python tools/notebook_proof_walk.py --self-check` -> 12/12 ok, exit 0, before any browser run | (same run) |

⚠️ **The `d5ca882b9` run's deadclick sweep hung and was hard-killed.** census, axe and silent
completed normally (each wrote its full JSON). deadclick's control check passed
(`[VALID] deadclick control`), then the per-surface loop measured 12 of 44 surface×mode cells
before the walk process stalled at essentially zero CPU for ~50 minutes on the next surface
(`nb-bulk`), with the sandbox's own access log still answering other tabs' requests throughout
(the backend was healthy; the stall was in the walk script's own Playwright-side logic). Per
this repo's own documented convention for exactly this shape
(`tools/notebook_perf_harness.py::Sandbox.stop`'s docstring: *"A hard kill is the LAST resort
and is recorded as such: a run stopped that way has no shutdown checkpoint, so its integrity
reads INCOMPLETE"*), both the walk process and the sandbox launcher were force-terminated;
verified after: port 8319 released, no orphaned chrome/node process referencing `wk3-data`.
Full account: `docs/notebook/proof/wk3-d5ca882b9/HUNG-deadclick.md`. Not diagnosed further --
reproducing it would cost the same wall-clock again for an uncertain payoff, and it is not one
of this lane's assigned defects.

## Load sampled (shared box; lane FX and other sessions were active throughout)

| | chrome | chrome-native-host | node | python | AvailMB |
|---|---|---|---|---|---|
| during census (both sandboxes not yet started) | 19 | 1 | 9 | 8 | -- |
| during the two-sandbox window (main walk + geometry re-run) | 19 | 1 | 16 | 9 | 6091 |
| after both sandboxes torn down | 17 | 1 | 23 | 6 | 11198 |

No orphan process from this lane's sandboxes (ports 8319/8329, data dirs `wk3-data`/`wk3-geo-data`)
survived teardown, including the hard-killed run -- checked by port listener + command-line
pattern immediately after each stop; none found.

## Clause by clause

### 9a -- zero accessibility violations on Notebook surfaces

**Reading: VALID and full coverage.** `docs/notebook/proof/wk3-d5ca882b9/axe.json`: control VALID
in every theme (planted low-contrast text + planted nameless button both reported in dark/oled/
light). **123 of 123 expected runs MEASURED, 0 UNREACHED, 0 violations on every run.** The
expected count is 123, not 43×3=129: three signed-out surfaces (`share-target`, `shared-page`,
`published-page`) are tested once each ("signed-out default"), by the sweep's own design
(`anon_done` in `axe_sweep`) -- a visitor with no session has no theme preference to switch, so
testing three themes there would be redundant, not a gap. Confirmed from source, not assumed.

**Comparison with wk-7bd834b9f (WK's original run): coverage went from 90/123 MEASURED (33
UNREACHED -- 10 editor-popup surfaces + `nb-bulk`, all root-scoping casualties) to 123/123.**
Every one of the 10 editor popups WK named (`ed-slash`, `ed-color`, `ed-table`, `ed-emoji`,
`ed-note-link`, `ed-link-paste`, `ed-history`, `ed-export`, `ed-delete`, `doc-preview`) now
reads MEASURED with 0 violations, confirmed individually against the raw JSON, not inferred.
`nb-bulk` (the one non-`ed-*` UNREACHED surface WK named) also reads MEASURED. Both WK's original
concern -- that `nb-note`/`nb-note-first-run`'s 0-violation PASS was likely hollow (scanning a
near-empty root) -- and F5's earlier full-coverage 0-violation reading are now reconciled: the
root correctly contains `.ProseMirror` (WK2's `MARK_ROOT_CONTAINS_EDITOR_JS` control, exercised
live on every `expect_editor=True` open in this run, never raised), so a 0-violation MEASURED
result here means the scan actually reached the editor and its toolbar.

**What this reading does NOT prove:** it does not re-run F5's own three previously-confirmed
accessible names (WritingHelpPanel/NoteOutline/TextColorMenu) as a separate check -- this run's
0 violations on `ed-writing-help`/`ed-outline`/`ed-color` is consistent with them, not a repeat
of that specific historical confirmation. It does not cover anything outside the 43-surface ×
3-theme manifest `a11y/notebookSurfaces.js` declares.

**Would this support MET?** Yes -- control VALID, full expected coverage, zero violations,
including every surface the prior run's root-scoping defect had hidden.

### 2c -- no dead clicks

**Reading: VALID control; PARTIAL coverage (12 of 44 surface×mode cells) due to an unrelated
instrument hang, documented above and in `HUNG-deadclick.md`.** `docs/notebook/proof/wk3-d5ca882b9/deadclick.json`:
`[VALID] deadclick control: every planted defect failed the instrument as it must` --
`plant-dead`/`plant-dead-styled`/`plant-live`/`plant-poller` read `DEAD`/`DEAD`/`LIVE`/`IN-WINDOW`.
**This is the first VALID deadclick control this program has ever produced** (10E-1 never
reached the sweep; WK's own run read INVALID, `plant-dead` LIVE, traced to the voice orb
cluster's DOM churn landing inside the click window because clause a's root-scoping bug put the
plant itself in app-chrome). WK2's diagnosis -- that fixing clause a alone recovers F7's
existing chrome-exclusion mechanism (`chrome()`/`ctlChrome` in `EFFECT_JS`) without touching it
-- is confirmed live here, on the real orb cluster, not just WK2's own diagnostic run.

**The 12 surfaces measured** (`nb-first-run-clicks`, `nb-home`, `nb-list` desk+phone, `nb-table`,
`nb-board`, `nb-calendar`, `nb-timeline`, `nb-graph`, `nb-tasks`, `nb-search`, `nb-trash`):
1,076 LIVE, 12 DEAD, 9 NOT-FOUND, 2 CURRENT-NO-OP, 5 OCCLUDED.

**The 12 DEAD clicks are all one pattern, named precisely:** `List view` (×2, desk+phone),
`Table view`, `Board view`, `Calendar view`, `Timeline view`, `Graph view`, `Tasks view` (the
view-mode switcher tabs), `Today` (×2, on `nb-calendar`/`nb-timeline`), and `UPDATED` (a sortable
column header on `nb-table`) -- every one of them a control that was **already the active/current
state** when clicked (clicking "List view" while already on the list view; clicking "Today" when
already showing today). `CONTROLS_JS`'s own `current` flag (which is meant to catch exactly this
class and route it to `CURRENT-NO-OP` instead of `DEAD`) requires, for a button, that it carry
`aria-pressed="true"` **inside** a `[role=group],[role=radiogroup],[role=tablist],[role=toolbar]`
container (`CONTROLS_JS` line ~510). `NotebookTab.jsx:1899` does set `aria-pressed={viewMode ===
id}` on these buttons, but whether their containing row carries one of those four roles was not
checked against source in this lane (out of the assigned scope, and product code is not mine to
read for this purpose under rule 12 boundaries this program applies elsewhere) -- **named here as
an open question for the controller/lane FX**: either these ARE genuinely inert re-clicks (a
product finding), or the row is missing a `role=tablist`/`role=group` wrapper and the instrument's
existing `CURRENT-NO-OP` path simply never triggers for them (an instrument gap, parallel in
shape to F7's/WK2's root-scoping class but not diagnosed to that depth here). Not fixed, not
asserted either way -- flagged with the exact evidence needed to settle it in one grep.

**5 OCCLUDED, all on `nb-first-run-clicks`** -- consistent with 6c's own finding that the
first-run tour card covers other controls (see below); not re-triaged separately here.

**What this reading does NOT prove:** it does not measure the other 32 surfaces (`nb-bulk`
onward in `SURFACES` order) -- named as OPEN, not silently rolled into "no dead clicks found".
It does not re-confirm whether the 12 DEAD findings are product-real or instrument
misclassification (see above). It does prove, for the first time in this program's history,
that the deadclick control itself can pass on the real app.

**Would this support MET?** Partially -- the control is VALID (a real advance from every prior
run, all of which were either never-run or INVALID), and the 12 surfaces reached show a clean,
explainable pattern with no unexplained dead click. It does not support a full MET on its own:
32 of 44 surfaces are unmeasured.

### 5d -- no silent failures

**Reading: VALID, and every read and write says something.** `docs/notebook/proof/wk3-d5ca882b9/silent.json`:
control VALID (planted swallowed 500/offline read SILENT; planted honest 500/offline read
SENTENCE, both kinds). **72 reads: 70 SENTENCE, 2 NOT-TRIGGERED** (`/api/j2/notes/{id}` GET,
both failure kinds, on `nb-list` -- the forced route was never hit in that context, i.e. nothing
to judge either way, not a silent failure). **24 writes: 18 SENTENCE, 4 EXEMPT, 2 NO-WRITE.**
**Zero SILENT anywhere.**

**WK's "5 write doors UNREACHED" (`lock`, `archive`, `save-template`, plus `save-body` timing
out on the root selector and `trash-note`) are resolved for 3 of 5, confirmed with evidence, not
assumed:**
- `save-body`: SENTENCE both kinds -- `"Saved in this browser — waiting to sync"` (the
  offline-first pattern, correct honest behaviour). Fixed by clause a alone (the root selector
  `{ROOT} .ProseMirror` now resolves).
- `lock`: SENTENCE both kinds -- `"Couldn't lock this note. Nothing changed."` Fixed by this
  lane's `_act_more_menu_click` (commit `aad774653`).
- `archive`: SENTENCE both kinds -- `"Couldn't archive this note. Nothing changed."` Same fix.
- `trash-note`: **reached** (no longer UNREACHED -- `s_ed_delete`, fixed by WK2, already opens
  the menu and clicks Delete before this door's own confirm click), but the write-action probe
  observed **NO-WRITE** -- the confirm click fired no captured non-GET request. Not diagnosed
  further in this lane; flagged, not asserted as fixed.
- `save-template`: **reached** (this lane's `_act_more_menu_click` finds and clicks the button),
  also **NO-WRITE** for the same reason as `trash-note` -- worth noting that the CENSUS sweep's
  own `f_save_template` (row G-155, reads WORKS on all 3 doors, see 2b below) verifies success by
  checking the word "template" appears anywhere in the page body, which could in principle be
  satisfied by the still-visible "Save as template" menu item's own label rather than a genuine
  save confirmation -- **not confirmed either way here**, named as a real open question rather
  than silently trusting the census WORKS verdict as independent corroboration.

**What this reading does NOT prove:** it does not cover the 2 NO-WRITE doors' actual failure
behaviour (their forced-500/offline test never ran, since no write request existed to force).
It does not re-verify F7's exemption list beyond confirming both entries still read EXEMPT here
(`/api/j2/notes/{id}/opened` on both `new-note` and `daily-note`).

**Would this support MET?** Yes for everything the sweep could force a failure against (zero
SILENT, 70+18 honest SENTENCEs, 4 correctly-declared EXEMPTs) -- with two named exceptions
(`save-template`, `trash-note`) where the door is reached but produces no write to test, which
is a coverage gap in this specific check, not a demonstrated silent failure.

### 6c -- no layout regressions at 390/820/1200

**Reading: VALID (six controls, all real, one control fixture bug found and fixed mid-lane);
full coverage.** `docs/notebook/proof/wk3-e6d1e93f7-geo/geometry.json`: control VALID --
`plant-wide`/`plant-small`/`plant-covered` found (WK2's mechanism, unchanged); **`plant-mislabel`:
named-the-real-occluder** (fix 1, this lane); **`plant-scroll-clear`: CLEAR, `plant-scroll-pinned`:
OCCLUDED** (fix 2, this lane). 43 surfaces × 3 widths = **129/129 cells MEASURED, 0 UNREACHED.**
2,227 raw findings: 1,914 occluded, 256 tap, 57 overflow.

**Clause d ("0 controls sampled on nb-note") is resolved, confirmed with numbers, not just
"no longer zero":** the editor toolbar and its controls are now sampled on `nb-note` at every
width (part of the same 129/129 MEASURED coverage above) -- WK's own comparison point (10E-1
sampling 0 controls on `nb-note`) no longer applies once the root correctly contains the editor.

**Fix 1 verified against the real app, not just the synthetic plant:** grepped the raw findings
for any occluder description quoting the app shell's skip-link text -- **zero matches.** (One
unrelated false-positive-looking hit, "Skip tour" on `nb-first-run` × 14 findings, is a REAL
product control -- the first-run tour's own Skip button, correctly named, `by_modal: true`,
nothing to do with the accessibility skip link.)

**Fix 2's real-world effect, counted:** of the controls the raw per-reading data re-tested
(occluded by a fixed/sticky element, with somewhere to scroll to), **30 were cleared** (would
have been false-positive findings under the old code: e.g. `Unfiled`/`Expand Sample notebook`/
`Archived` on several list-type surfaces at 390px, covered by the app's floating chrome only
transiently) and **751 were re-tested and correctly stayed occluded** (the fix is not a blanket
pass -- most fixed-chrome overlaps are real).

**Triaged findings, named:**
- **1,775 of 1,914 occluded findings carry `by_modal: true`** -- a control covered by a dialog
  the SURFACE ITSELF opened (a backdrop/bottom-sheet/modal over the background), by design, and
  the large majority of the total (dominant occluders in the raw data: `._backdrop_.._bottom-sheet_`
  885 hits, `._backdrop_.._modal_` 612 hits across the popup-testing surfaces `ed-*`/`doc-preview`/
  etc., now correctly reached where WK's run could not reach them at all).
- **Non-modal, chrome-level occluders, same four named in WK's run, still present, not new:**
  the voice orb cluster (16 hits), the Log-Trade FAB (9 hits), the app shell's top bar/skip-link
  slot (header/topBarRight/pageTitle, ~44 hits combined), and the editor's own "More note
  actions" overflow panel covering a neighbour when left open mid-surface-test (43 hits across
  3 note-scoped surfaces) -- none of these are `app/src/pages/journal-2-0/**` code; fixing any
  is a shell/voice change, out of this lane's scope, reported with cause, not attempted.
- **1 non-orb overflow finding, unchanged from WK's run: `support @390`, `main` 406px vs 390px
  viewport.** Same surface, same 16px overflow WK named; Support is not a journal-2-0 surface,
  not fixed here.
- **12 sub-24px tap findings, all the same accepted pattern WK already named:** "Task item
  checkbox for Review the base" 16×16, now appearing on 8 editor-popup surfaces (`nb-note`,
  `ed-color`, `ed-table`, `ed-emoji`, `ed-note-link`, `ed-link-paste`, `ed-export`, `ed-delete`,
  `ed-property`) instead of the 2 WK could reach -- the established checkbox-plus-44px-label
  precedent (A2R-10), not a new defect; more instances found only because more surfaces are now
  reachable.
- **244 findings in the 24-44px band** -- the product's own already-ratified 24px floor
  (`targetFloors.test.js`), not the instrument's stricter 44px reading; not individually triaged,
  matching WK's own treatment of this band.
- **"Joystick, Notebook" (L3/D3P's 390px finding): still NOT MEASURED by this instrument.**
  Unchanged from WK's run -- this walk's geometry manifest does not sample the joystick hub's
  own controls; confirming or denying it needs the L3/D3P-style targeted probe, not this one.

**What this reading does NOT prove:** it does not individually triage every one of the ~139
non-modal, non-orb/FAB/shell/menu-panel occluder hits (the tail beyond the four named app-chrome
groups) by CSS-module hash to source file -- WK's own run named four groups after tracing each
by grep; this lane confirmed the SAME four groups still dominate and did not re-run that
grep-by-grep trace given the scope already covered. It does not confirm or deny the joystick hub
finding (see above).

**Would this support MET?** Yes -- control VALID (six controls, including both this lane's new
ones), full 129/129 coverage, and every finding either triaged as by-design (modal backdrops),
already-accepted (the 24-44 band, the checkbox pattern), previously-named and unchanged
(`support` overflow), or app-chrome/out-of-lane (orb cluster, FAB, shell, menu panel) -- no new
Notebook-owned layout regression found.

### 2b -- every shipped feature works on every path

**Reading: VALID, near-total resolution of WK's regression.** `docs/notebook/proof/wk3-d5ca882b9/census.json`:
control VALID (planted no-door read NO-DOOR, planted broken-door read BROKEN, on all 3 doors).
**55 rows × 3 doors = 165 cells: WORKS 112, N/A 30, NOT-DRIVEN 22, NO-DOOR 1. Zero BROKEN, zero
INCONCLUSIVE.**

**Comparison: WK (INCONCLUSIVE 27, NO-DOOR 35, BROKEN 1, WORKS 51) -> this run (INCONCLUSIVE 0,
NO-DOOR 1, BROKEN 0, WORKS 112) -> even ahead of 10E-1's pre-regression baseline (WORKS 110, NO-DOOR
1, BROKEN 2).** The N/A and NOT-DRIVEN counts hold exactly (30/30, 22/22 -- WK read 21 for
NOT-DRIVEN; the +1 here is accounted for by G-171's keyboard door reading NO-DOOR rather than
NOT-DRIVEN in either run, not a drift in what counts as by-design).

**Every specific row this lane was asked to re-examine, confirmed WORKS with evidence, not
assumed:**
- **Word count** (G-137): WORKS on desktop/touch/keyboard. `f_word_count` opens "More note
  actions" first (owner ruling D-3 moved word count into that menu) -- already fixed by WK2,
  confirmed live here.
- **Bulk select** (G-146, "Bulk operations"): WORKS on all 3 doors. `f_bulk` finds the
  `input[type="checkbox"][aria-label^="Select "]` boxes on `/journal/notebook?view=all` (default
  `viewMode='list'`, where `selectionOn` is true) -- resolved as a pure consequence of clause a's
  root fix, no `f_bulk`-specific change needed. WK's "no select boxes on the list" NO-DOOR was
  the root-scoping bug, not a missing feature.
- **Archive** (G-150) / **Lock** (G-151): WORKS on all 3 doors -- `f_note_btn` already opens
  "More note actions" (WK2's fix), confirmed live.
- **Split view** (G-152): desktop WORKS, touch N/A (by design -- desktop-only, needs ≥1025px),
  keyboard WORKS.
- **Member-made templates** (G-155): WORKS on all 3 doors -- `f_save_template` opens the menu
  (WK2's fix); see 5d above for the separate, unresolved question about whether the underlying
  write actually fires.
- **Export formats** (G-169): WORKS on all 3 doors -- `f_export` opens the menu (WK2's fix).

**The one remaining NO-DOOR, unchanged across every run of this program: G-171, "First-run tour
+ sample notebook", keyboard door -- `"not reached with Tab in 220 presses"`.** Identical finding
to WK's own run (same wording, same door). This is the one census finding this lane did NOT see
resolve, and it reproduces consistently enough across runs (10E-1, WK, this lane) to be treated
as a real, standing product gap rather than instrument noise -- reported for the controller/lane
FX, not fixed here (out of this lane's mandate and rule 12's product-code boundary).

**What this reading does NOT prove:** it does not re-verify `save-template`'s and `trash-note`'s
underlying writes independently of the census's own text-match check (see 5d's flag on
`f_save_template`'s verification method). It does not cover any row this walk's manifest does
not carry (the census is `tools/notebook_proof_walk.py`'s own 55-row list, not the full
scorecard).

**Would this support MET?** Yes -- control VALID, 165/165 cells resolved to a clean verdict, zero
BROKEN, zero INCONCLUSIVE, and the single NO-DOOR is a named, reproducing, pre-existing finding
rather than a fresh regression.

## Product defects / open questions for the controller and lane FX (not fixed here -- product
code is not this lane's to touch)

1. **G-171 keyboard door: the first-run tour is not reachable with Tab in 220 presses.**
   Reproduces identically across 10E-1, WK and this lane's runs. `docs/notebook/proof/wk3-d5ca882b9/census.json`,
   row G-171.
2. **The 12 deadclick DEAD findings (view-mode tabs, `Today`, a table sort header) all share the
   "already the active/current state" shape.** Either a genuine dead re-click, or the
   `CONTROLS_JS` `current` heuristic's `role=group|radiogroup|tablist|toolbar` requirement is not
   met by the view-mode tab row's container, in which case the instrument's own `CURRENT-NO-OP`
   path should be catching these and is not. Named with exact control names and the exact
   `CONTROLS_JS` clause in question; not traced further against `NotebookTab.jsx` source in this
   lane.
3. **`save-template` and `trash-note` write actions are reached but fire no captured write
   request** in the silent sweep's WRITE_ACTIONS probe, even though their census counterparts
   read WORKS. Two explanations were not distinguished: (a) both features need a second
   confirmation step beyond the single click this lane's fix performs, or (b) census's own
   "template" text-match verification is satisfied by the still-open menu's own label rather
   than a genuine save, meaning G-155's WORKS may itself be a false positive. `docs/notebook/proof/wk3-d5ca882b9/silent.json`
   (`save-template`/`trash-note` rows) and `census.json` (row G-155).
4. **Deadclick coverage is 12 of 44 surfaces** -- `nb-bulk` onward is unmeasured (the sweep
   hung there and was hard-killed; see `HUNG-deadclick.md`). Named as OPEN, not a finding either
   way.
5. **"Joystick, Notebook" (L3/D3P's 390px occlusion finding) is still not measured by this
   instrument** -- unchanged from every prior run of this program.

## Sandbox integrity

**census/axe/silent/deadclick run (`d5ca882b9`): INCOMPLETE**, not CLEAN -- pre-boot, post-boot
(+15s) and post-prewarm (+120s) all CLEAN (62 db files hashed each time, `C:\data` untouched);
no shutdown checkpoint, because the run was hard-killed after the deadclick sweep hung (see
above). Nothing in the three checkpoints taken suggests a shared-root write occurred, but the
shutdown state itself was never measured, and this README does not assert it was.

**geometry re-run (`e6d1e93f7-geo`): CLEAN at all four checkpoints** (pre-boot, post-boot,
post-prewarm, shutdown), 62 db files hashed each time, `stop: "graceful (rc 0)"`.

## Refused / not completed

Writing INTO the shared `app/node_modules` junction's target (another lane's real install) was
refused by this session's own permission layer as a shared-resource modification -- worked
around with a read-only env-var override pointing at this lane's own scratchpad (see the fixes
table). The deadclick sweep's hang past `nb-bulk` was not diagnosed to its root cause -- named,
hard-killed per this repo's own documented convention, not silently retried or hidden.
