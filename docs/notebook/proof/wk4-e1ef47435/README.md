# Notebook wave 10 -- the proof instruments' evidence (lane WK4)

Raw records are committed BEFORE this interpretation (R-RAW). Every number below cites the raw
file it was read from. This lane's mandate: fix the dead-click sweep's hang on `nb-bulk` (WK3's
`docs/notebook/proof/wk3-d5ca882b9/HUNG-deadclick.md`), fix G-155's weak page-text success
signal, fix the 5d save-template/trash-note doors, then run the full walk on the tip and report
honestly. **This run found a second, more serious instrument defect while proving the first fix
-- the deadclick timeout mechanism itself is unusable with Playwright's sync API. Nothing was
patched live; per the controller's instruction this is stopped and reported, not fixed under
pressure.**

## Instrument fixes landed in this lane (all on `feat/notebook-w10-wk4`)

| commit | fix | rail | mutation result |
|---|---|---|---|
| `e1ef47435` | Dead-click hang: a generic wall-clock watchdog (`_run_with_deadline`, `threading.Thread` + `join`) wraps `click_one` per-control (`_click_or_timeout`, 25s) and `deadclick_surface` per-surface (`deadclick_surface_bounded`, 360s), recording a stuck call as a named TIMEOUT and continuing the sweep. **See "The threading defect" below -- this mechanism is broken for real Playwright calls; the rails below only proved its logic against fakes.** | 3 new tests (`test_a_stuck_call_times_out_named_and_the_context_is_force_closed`, `test_a_hanging_click_is_named_TIMEOUT_and_the_next_control_still_runs`, `test_a_hanging_surface_is_named_TIMEOUT_and_salvages_what_it_measured`) | reverted `_run_with_deadline` to `return False, fn()` -> all 3 RED; restored, sha256 verified (`f1c5853845e2...`); suite 31->34 |
| `e1ef47435` | G-155 (census `f_save_template`): the old check (`"template"` appears anywhere on the page) was satisfied by the still-open "Save as template" disclosure's own label. Now drives the form's real submit and asserts `GET /api/j2/note-templates` lists a new row named for the note. | (reuses the census's own must()/Broken discipline; no new pure-Python rail -- verified live, see 2b below) | n/a -- browser-probe change, verified live |
| `e1ef47435` | 5d `save-template` write probe: `_act_save_template` opens the menu, clicks "Save as template", waits for the name field, clicks "Save template" (the old `_act_more_menu_click` stopped at the reveal, which is why WK3 read NO-WRITE). | `test_lock_archive_and_save_template_writes_open_the_more_menu_first` (existing WK3 rail, unmodified, still passes: `_act_save_template` calls `open_more_note_actions(pg)` directly) | verified live, see 5d below |
| `e1ef47435` | 5d `trash-note` write probe: `_act_confirm_delete` clicks the first "Delete" confirm as before, then also drives `UnsentTrashDialog`'s "Trash anyway" if NoteEditorPage's `onDeleteConfirm` takes that second-confirm branch. | (same as above) | verified live, see 5d below |
| `4f31a9075` | G-171 keyboard door: FX2 diagnosed (`docs/notebook/proof/fx2-788f3a439/item1-g171-keyboard/`) that `f_first_run` read `tour.count() > 0` the instant the page's own heading appeared, well before the tour DIALOG itself lazy-loads -- always sampling it absent, skipping the dismiss branch, letting the tour open and correctly trap keyboard focus around "Add a sample notebook". `_first_run_tour_seen()` now WAITS for the dialog (bounded, 1500ms) instead of sampling once. | `test_the_first_run_tour_is_WAITED_for_not_sampled_once` (a fake Locator whose element attaches after a delay, plus two CONTROLs) | reverted to `return tour_loc.count() > 0` -> RED; restored, sha256 verified (`f0a09cee5542...`); suite 34->35 |

`python tools/notebook_proof_walk.py --self-check`: 12/12 ok, exit 0 (unaffected -- self-check
exercises the pure judge functions, not `run_sweeps`/the browser/threading code).
`python -m pytest tests/test_notebook_proof_walk.py -q`: **35 passed** (was 31 at dispatch).

## THE THREADING DEFECT -- found by this run, not patched, reported

`_run_with_deadline` (both fixes above) runs the wrapped call -- `click_one` or the whole of
`deadclick_surface` -- on a `threading.Thread`, so a timeout can force-close the stuck call's
browser context from the OUTER thread while the worker thread is abandoned. **Playwright's
Python sync API is not thread-safe in the way this requires**: every Playwright object (`Page`,
`BrowserContext`, `Locator`, ...) is dispatched through a greenlet bound to the ONE thread that
created the `sync_playwright()` context, and calling ANY Playwright method from a different OS
thread raises immediately:

```
error: Cannot switch to a different thread
	Current:  <greenlet.greenlet object at 0x... current active started main>
	Expected: <greenlet.greenlet object at 0x... suspended active started main>
```

(`docs/notebook/proof/wk4-e1ef47435/deadclick.json`, `controls.raw.reason` and every one of the
39 per-surface `reason` fields, verbatim.)

**This is categorical, not load- or timing-dependent.** The FIRST Playwright call made from
inside the worker thread -- in this run, `deadclick_surface`'s own `fresh()` opening `nb-list`
for the plant control -- fails within the same fraction of a second every time. `deadclick_surface`
already wraps `fresh()` in its own pre-existing try/except (unmodified by this lane), which
catches the exception and sets `status="UNREACHED"` -- so the failure is fast and silent-looking
in aggregate (`run.json`: `deadclick` sweep took **0.4 seconds** total, `findings: 0`), never a
hang, and **never produces a TIMEOUT verdict**: the deadline mechanism's own timeout path never
gets the chance to fire, because the wrapped call fails on its own, instantly, for an unrelated
reason.

**Why the rails did not catch this.** All three deadclick rails (this lane's own, see the table
above) replace `click_one` / `deadclick_surface` with plain Python fakes that never touch a real
Playwright object -- proving the watchdog's timeout/kill/salvage LOGIC is correct in isolation,
which it is, but never exercising a real Playwright call from the worker thread. The gap is the
exact shape this repo's CLAUDE.md already names: a mock that never reaches the real dependency.

**Net effect on this run's evidence:** the deadclick sweep measured NOTHING. It cannot say
whether `nb-bulk` (or any of the other 38 surface x mode cells) still hangs, because none of them
ever got a real click. Silence, not a false pass -- `deadclick`'s `control_ok` reads `false` and
every surface reads UNREACHED with a reason string, never a fabricated MEASURED.

**Not fixed here, per the controller's explicit instruction** ("if nb-bulk still hangs the
process past the per-surface budget, stop and report; do not patch further" -- the spirit of
that applies at least as strongly to a defect worse than a hang). Candidate directions for
whoever picks this up, named without commitment to any: (a) drive Playwright's own **async** API
with `asyncio.wait_for()` per-call timeouts instead of a second OS thread; (b) run the
timed-out call in a **separate process** (not thread) and read its result over IPC, since a
process boundary does not share the greenlet; (c) since `page.evaluate()` is the one call this
lane could not find any Playwright-native timeout for, investigate whether the specific stuck
call (still unconfirmed -- see WK3's `HUNG-deadclick.md`) can be avoided or bounded a different
way instead of wrapping arbitrary Playwright code in a thread. This lane's own `_run_with_deadline`
rails (pure-Python, fakes only) remain valid proof of the watchdog LOGIC and are worth keeping
once the real Playwright-safe delivery mechanism replaces the thread.

## What ran, on what

One run, `--boot`, tip `e1ef474354e86a7f0c7905a8b10a1d7602e756f8` (this lane's own first
instrument-fix commit; **the G-171 fix at `4f31a9075` landed after this run's process had
already started and is NOT reflected in census.json's G-171 row below** -- expected, not a
regression; the re-measure happens on the controller's later L11 walk, not a fresh run from this
lane).

| | |
|---|---|
| sandbox | `<scratchpad>\wk4-data`, port 8347 |
| record | `docs/notebook/proof/wk4-e1ef47435/{run,census,axe,silent,deadclick,geometry-*,integrity}.json` + this README |
| sandbox integrity | **CLEAN** at all four checkpoints (pre-boot, post-boot +15s, post-prewarm +120s, shutdown), 62 db files hashed each time, `stop: "graceful (rc 0)"` |
| self-check | `python tools/notebook_proof_walk.py --self-check` -> 12/12 ok, exit 0, before the browser run |
| wall time | 00:12:44 -> 01:22:06 local, ~69m22s |

`geometry.json` (5,619,895 bytes) exceeded the repo's 5 MB hygiene limit -- split by mode into
`geometry-controls.json` + `geometry-{phone,tablet,desktop}.json`, verified byte-for-byte against
the original before the combined file was deleted (0 mismatches across all 129 cells). See
`geometry-SPLIT.md`.

## Load sampled (shared box; other sessions were active throughout)

No box-wide load sampling table was taken for this run (unlike WK3's) -- not measured, stated as
such rather than guessed. What IS known: 10-14 GB available (PowerShell `Get-Counter`) at launch,
and the run completed on its own schedule with a clean graceful shutdown (no OOM signature, no
killed process). The controller separately reported a six-shard gate running in a sibling
worktree (`notebook-w10-l10`) as of its message near this run's END -- this lane never touched
that worktree, and whether that gate overlapped this run's ~69-minute window is not established
either way.

## Clause by clause

### 9a -- zero accessibility violations on Notebook surfaces

**Reading: VALID and full coverage.** `axe.json`: control VALID in every theme (planted
low-contrast text + planted nameless button both reported in dark/oled/light --
`controls.got == {"color-contrast": "found", "button-name": "found"}`). **123 of 123 expected
runs MEASURED, 0 UNREACHED, 0 violations on every run** (`Counter(status for runs) ==
{"MEASURED": 123}`; `sum(violations) == 0`). Matches WK3's own prior reading exactly, on this
lane's tip -- this clause was not touched by this lane's fixes and reproduces unchanged.

**Would this support MET?** Yes -- control VALID, full expected coverage, zero violations.

### 2c -- no dead clicks

**Reading: the control is INVALID and 0 of 39 expected surface x mode cells were measured.**
`deadclick.json`: `controls.ok == false`, `controls.why == "plant-dead: got None, must be
'DEAD'; plant-dead-styled: got None, must be 'DEAD'; plant-live: got None, must be 'LIVE';
plant-poller: got 'NOT-SEEN', must be 'IN-WINDOW'"`. Every one of the 39 expected surface x mode
cells (the full `SURFACES` list filtered to `"deadclick" in sweeps` -- computed, not counted by
eye) reads `status: "UNREACHED"` with the identical reason string named in "THE THREADING
DEFECT" above. **Verbatim, every surface and mode, all 39:**

```
nb-first-run-clicks/desk · nb-home/desk · nb-list/desk · nb-list/phone · nb-table/desk ·
nb-board/desk · nb-calendar/desk · nb-timeline/desk · nb-graph/desk · nb-tasks/desk ·
nb-search/desk · nb-trash/desk · nb-bulk/desk · nb-templates/desk · nb-import/desk ·
nb-saved-view/desk · nb-publish-folder/desk · nb-note/desk · nb-note/phone · ed-slash/desk ·
ed-find/desk · ed-outline/desk · ed-color/desk · ed-table/desk · ed-emoji/desk ·
ed-note-link/desk · ed-link-paste/desk · ed-writing-help/desk · ed-history/desk ·
ed-palette/desk · ed-share/desk · ed-export/desk · ed-ask/desk · ed-delete/desk ·
ed-property/desk · doc-preview/desk · nb-research/desk · settings-cards/desk ·
capture-dialog/desk
```

**`nb-bulk/desk` is in that list, UNREACHED, same as every other surface** -- confirmed, in the
raw JSON, not by eye. **Zero surfaces read TIMEOUT.** The mechanism built to catch a hang
(the whole point of this lane's dispatched work) never had the chance to run against a real
click this run, for the reason in "THE THREADING DEFECT" above.

**What this reading does NOT prove:** it does not establish whether `nb-bulk` (or anything else)
still hangs the way it did for WK3. It does not measure a single real click. It proves the
opposite failure mode from a silent pass: the sweep correctly reported it could not measure
anything, by name, with a reason -- not a fabricated MEASURED.

**Would this support MET?** No. INCONCLUSIVE by construction -- the control itself is INVALID,
so nothing downstream of it can be trusted even where a status happens to read something other
than UNREACHED (nothing does, here).

### 5d -- no silent failures

**Reading: VALID control; two real write doors now reach their actual endpoints, and one of them
(the door this lane was specifically asked to check) reads a genuine SILENT failure.**
`silent.json`: control VALID (planted swallowed 500/offline read SILENT; planted honest
500/offline read SENTENCE, both kinds). **Reads: 72/72 SENTENCE, 0 SILENT, 0 NOT-TRIGGERED**
(an improvement on WK3's 70 SENTENCE / 2 NOT-TRIGGERED -- this run's account state happened to
trigger both previously-untriggered read paths; not a fix, not chased further). **Writes: 30
rows -- 22 SENTENCE, 4 EXEMPT, 3 SILENT, 1 NOT-TRIGGERED.**

**save-template (this lane's probe fix): now reaches BOTH of its real writes, both honest.**
`_act_save_template` submits the inline form; the forced-failure sweep found TWO write endpoints
under that one action (the editor's own pre-template save, then the template creation itself)
and forced each, both kinds:
- `PUT /api/j2/notes/{id}` (the pending-edits save `onBeforeTemplate` fires first): SENTENCE both
  kinds -- *"Your latest edits haven't reached the server yet, so the template would miss the
  [...]"*.
- `POST /api/j2/note-templates` (the actual template write): SENTENCE both kinds -- *"Couldn't
  save this note as a template. Nothing was saved."*

Zero SILENT, zero NO-WRITE. FX2 independently confirmed (per the controller) that the real
write only fires on the form's "Save template" submit, matching this lane's own reading of
NoteMenuActions.jsx.

**trash-note (this lane's probe fix): now reaches its real write -- and the write is SILENT,
both kinds.** `_act_confirm_delete`'s first "Delete" click was sufficient in this run (the
"Trash anyway" second-confirm fallback did not need to fire, i.e. this note did not read as
holding unsent work) and the forced-failure sweep reached the real door:
- `DELETE /api/j2/notes/{id}`: **`SILENT`** under a forced 500, **`SILENT`** under forced
  offline. No sentence, no visible change -- the member gets no indication the delete failed.

This is the door 5d's own mandate named explicitly ("trash needs the 'Delete this note?' confirm
clicked... Fix the PROBE so each door either sees its real write, or records precisely why
not") and the probe now sees the real write. **What it sees is a genuine silent-failure
candidate, not a probe gap** -- reported here for whoever owns silent-failure fixes; not fixed by
this lane (product code is not this lane's to touch, and the finding needs its own
confirm/reproduce pass, e.g. is the confirm dialog's copy checked against a response, or does it
optimistically assume success and simply not re-render on failure).

**A second, incidental SILENT finding, not part of this lane's assigned scope:** `add-tag`'s
PATCH `/api/j2/notes/{id}/tags` is honest both kinds (SENTENCE), but the write probe also found
a SECOND endpoint under that same action, `PUT /api/j2/notes/{id}` (a secondary note-save the tag
add appears to trigger) -- `NOT-TRIGGERED` under a forced 500 (the forced route was never hit
that way in this run, i.e. nothing to judge), **`SILENT` under forced offline**. Named here
because it was found, not chased: unlike `save-body`'s own primary PUT (which reads SENTENCE,
"Saved in this browser -- waiting to sync"), this secondary PUT under `add-tag` produces nothing
visible when forced offline. Whether this is the same code path as `save-body`'s honest offline
handling or a different, less-instrumented one is an open question for whoever picks this up.

**What this reading does NOT prove:** it does not re-verify F7's exemption list beyond
confirming all 4 entries still read EXEMPT here. It does not diagnose WHY trash-note's DELETE or
add-tag's secondary PUT are silent -- only that they are, reproducibly, under both forced-failure
kinds where applicable.

**Would this support MET?** Partially. Every OTHER read and write is honest (72 reads + 26 of 30
writes = honest; 4 EXEMPT correctly declared). Two real, now-reachable write doors are silent on
failure -- `trash-note`'s DELETE (both kinds) and `add-tag`'s secondary PUT (offline only) --
named findings for the product side, not instrument gaps.

### 6c -- no layout regressions at 390/820/1200

**Reading: VALID, full coverage, unchanged from WK3's fixed instrument.** `geometry-controls.json`
+ `geometry-{phone,tablet,desktop}.json`: control VALID -- all six planted controls confirmed
(`plant-wide`/`plant-small`/`plant-covered`/`plant-mislabel`/`plant-scroll-clear`/
`plant-scroll-pinned`, same mechanism WK3 landed). **129/129 cells MEASURED, 0 UNREACHED**
(computed from the three per-mode files, not assumed). **2,278 raw findings: 1,993 occluded (1,838
`by_modal: true`, 155 non-modal), 229 tap, 56 overflow** -- same shape as WK3's own reading
(1,914/256/57), not re-triaged control-by-control in this lane since this clause's own instrument
was not touched here and the counts are consistent with an unmodified sweep on a very similar
tip.

**What this reading does NOT prove:** it does not re-triage the ~155 non-modal occluder hits by
CSS-module hash to source file (WK3 already did this trace and named the same four app-chrome
groups; this lane did not re-run that grep-by-grep pass since the geometry instrument is
unmodified).

**Would this support MET?** Yes -- control VALID, full 129/129 coverage, consistent with WK3's
own already-accepted reading; this lane changed nothing in the geometry instrument or the
product surfaces it measures.

### 2b -- every shipped feature works on every path

**Reading: VALID, and this lane's two assigned rows both now read WORKS on stronger evidence.**
`census.json`: control VALID (planted no-door read NO-DOOR, planted broken-door read BROKEN, on
all 3 doors). **55 rows x 3 doors = 165 cells: WORKS 112, N/A 30, NOT-DRIVEN 22, NO-DOOR 1. Zero
BROKEN, zero INCONCLUSIVE** -- identical counts to WK3's own run, confirming this lane's fixes
did not regress anything census measures.

**G-155 (Member-made templates): WORKS on all 3 doors, now on an independent signal.**
`f_save_template` submits the real form and asserts `GET /api/j2/note-templates` lists a new row
named for the note -- desktop: `"click; click"`, touch: `"tap; tap"`, keyboard:
`"Tab x4 + Enter; Enter (submits the template-name field)"` (the keyboard door's own detail
string, confirming the new code path actually ran). This replaces the old page-text check
(`re.search(r"template", ...)`, which the reveal-only form label could satisfy without any
write) with the API-backed check this lane's brief asked for.

**G-171 (First-run tour + sample notebook): unchanged from WK3 -- expected, not a regression.**
desktop and touch: WORKS (`"tour shown: False; Skip tour; click"` / `"...; tap"` -- the tour did
not auto-open in either of THESE two attempts, and the door works regardless). keyboard:
**NO-DOOR, `"not reached with Tab in 220 presses"`** -- **pre-fix tip; the probe fix for this is
`4f31a9075`, landed on this branch AFTER this run's process had already started.** The
controller's own instruction: label it exactly this way, and it is -- this is not a fresh finding
and not something this lane re-broke; the fix exists on this tree's tip (current HEAD, not the
tip this run measured) and will be re-measured on the controller's L11 walk.

**What this reading does NOT prove:** it does not re-verify `trash-note`'s and `add-tag`'s
underlying silent-failure findings independently of what 5d already covers (see above -- census
only checks that the DOOR works, not that a FORCED FAILURE on it is honest). It does not cover
G-171 with this lane's own fix applied (see above).

**Would this support MET?** Yes -- control VALID, 165/165 cells resolved to a clean verdict, zero
BROKEN, zero INCONCLUSIVE, both of this lane's assigned rows resolved as intended (G-155 on
stronger evidence; G-171 unchanged and correctly labelled as pre-fix-tip).

## Product defects / open questions for the controller and lane FX2 (not fixed here -- product
## code is not this lane's to touch)

1. **`trash-note`'s DELETE is SILENT on both forced-500 and forced-offline**, now that the probe
   reaches the real write (this lane's own fix). `silent.json`, `trash-note` rows. Distinct from
   the `unsentInEditor` false-positive FX2 already fixed in `b7a3cae6a` (this is about what
   happens when the confirmed delete's own network call fails, not about the pre-delete unsent-
   work check).
2. **`add-tag`'s secondary write (`PUT /api/j2/notes/{id}`) is SILENT under forced offline**
   (500 kind never triggered this run -- NOT-TRIGGERED, not judged). `silent.json`, `add-tag`
   rows. Not part of this lane's assigned scope; found incidentally while reading the write
   probe's full output.
3. **G-171's keyboard door is still NO-DOOR on the tip this run measured** -- expected: the fix
   (`4f31a9075`) is on this branch's current HEAD, after this run's process started. Needs a
   fresh measurement (the controller's L11 walk) to confirm resolved.
4. **The deadclick sweep cannot run at all with this lane's current timeout mechanism** -- see
   "THE THREADING DEFECT" above. This blocks ANY future deadclick measurement (not just
   `nb-bulk`) until the mechanism is redesigned around a Playwright-safe delivery (not a second
   OS thread). This is the load-bearing open item from this lane's work.
5. **The original nb-bulk hang WK3 reported is neither confirmed nor denied by this run.** Zero
   real clicks were measured. Whoever redesigns the timeout mechanism should expect to
   re-encounter whatever WK3 hit, now with a WORKING watchdog around it, and can finally name it
   empirically by control + surface (as this lane intended before finding the threading defect).

## Sandbox integrity

**CLEAN at all four checkpoints** (pre-boot, post-boot +15s, post-prewarm +120s, shutdown), 62 db
files hashed each time, `C:\data` untouched throughout, `stop: "graceful (rc 0)"`.
`docs/notebook/proof/wk4-e1ef47435/integrity.md` is the full log.

## Refused / not completed

The threading defect in `_run_with_deadline` was found DURING this run and is explicitly NOT
patched here, per the controller's instruction to stop and report rather than patch further once
a deadclick-sweep-breaking issue was found. No fresh run was started to compensate -- this run's
raw evidence is committed and reported as-is, honestly labelled where it could not measure
something, per R-RAW and R-HON.
