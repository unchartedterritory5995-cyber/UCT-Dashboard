# Lane AX (wave 10) -- accessibility re-measured on `2fb102c74`

Tree measured: `feat/notebook-w10-l4` @ **`2fb102c74`** (L4 + master `5acc73133`), checked out as
`feat/notebook-w10-ax`, with `app/dist` rebuilt from it. Every raw record in this directory was
committed BEFORE this interpretation (R-RAW). Scorecard clauses: **9a** "zero violations on Notebook
surfaces" and **9d** "keyboard-complete (incl. graph)".

## ⛔ Refused: the SAME axe instrument as F5 was not re-run

F5's reading (`../f5-after-aa2417c2c/run.json`, 123/123 runs PASS over 43 surfaces x 3 themes)
names its instrument in its own header: `"instrument": "tools/notebook_proof_walk.py"`. F5's wrapper
`../f5-after-aa2417c2c/instrument/f5_walk.py` does `import notebook_proof_walk as PW` and calls
`PW.axe_sweep`. The lane brief forbids reading or running `tools/notebook_proof_walk.py` (not
granted by the owner). **The instrument the brief asks to re-run and the tool it forbids are the
same program.** It was not run, and no substitute re-implementation of it was written. That would
be a workaround, and its numbers would not be comparable with F5's anyway.

**So 9a has NO re-measurement at `2fb102c74` across F5's 43 surfaces**, and the L4 surfaces the
brief lists are covered as follows:

| L4 surface | real-browser axe at 2fb102c74 | why |
|---|---|---|
| Template gallery | **YES**: 0 violations at 1200 / 820 / 390 | lane D2's own instrument (below) |
| Phone editor, "Aa Format" open and closed | **NO** | only F5's instrument covers it |
| Phone "More note actions" panel | **NO** | only F5's instrument covers it |
| Board view with the D5 scroll fade | **NO** | only F5's instrument covers it |

**Owner decision needed:** either grant `tools/notebook_proof_walk.py` to a lane (its sweep is
the only instrument whose number is comparable with F5's 123/123), or name another instrument.

## What WAS measured

### 1. The a11y CI rails (jsdom axe + contrast + focus): `rails-vitest-a11y.log`

`npx vitest run src/pages/journal-2-0/a11y/ --maxWorkers=2`, the exact command the promotion-gating
workflow `.github/workflows/notebook-a11y.yml` runs: **Test Files 23 passed (23) · Tests 261
passed | 1 skipped (262)**. Among them, `noteEditor.a11y.test.jsx` opens "More note actions" and
`notebookTab.a11y.test.jsx` runs axe on `tab-board`. ⚠️ **jsdom does no layout**: it cannot
apply the <=640 px tier (where "Aa Format" exists), cannot render the board's fade, and axe's
`color-contrast`/`target-size` need layout. This supports 9a only as a CI gate that is green on
this tree. It is not a real-browser reading.

### 2. Template gallery, real browser: `gallery-axe/gallery-axe.json`

Instrument: `instrument/ax_gallery_axe.py`. It COMPOSES lane D2's two instruments without changing
them: `d2_phone_measure.seed` (four notes; D2's gallery run had them because `d2_phone_measure`
ran first) and `d2_gallery_capture.run_viewport` (axe-core 4.13.0 from `app/node_modules` on the
open dialog, the 40-Tab trap, arrows/Home/End, Escape). **Added: a control** (D2's capture has
none). A nameless `<button>` planted in the open dialog must be reported, and it was:
`control.reported.ids = ["button-name"]`, `valid: true`.

| viewport | axe violations | dialog name / aria-modal | cards | 40 Tabs stay inside | Escape |
|---|---|---|---|---|---|
| 1200x800 | **0** | "New note" / true | 11 | yes | closes, focus on Templates |
| 820x1180 touch | **0** | "New note" / true | 11 | yes | closes, focus on Templates |
| 390x844 touch+mobile | **0** | "New note" / true | 11 | yes | closes, focus on Templates |

Attempt 1 (`gallery-axe-attempt1-unseeded/`) is **INCONCLUSIVE**: the fresh member had no notes,
and every viewport timed out waiting for a note card before the gallery opened. It is not a product
reading.

→ Supports **9a for the template gallery only**, in one theme (the default), with a control.

### 3. Keyboard walk (9d)

Same widths as the last run (1280x800 unless a step says otherwise; S6 at 390 / 820 / 640 / 320).
Two instruments, both run against one sandbox:

- **`keyboard/`**: lane 10E-2's `keyboard_walk.py`, **unmodified** except three shims that change
  no step (the helpers' in-tree paths and the recorded `tip`; diff in
  `instrument/keyboard_walk_ax.py`). F4's scratch copy carried the same kind of shims. The first
  run's S2c section died on a cp1252 console `print` (not a product step), so S2c was re-run with
  `PYTHONIOENCODING=utf-8` (`keyboard/walk-S2c.json`).
- **`keyboard-k2route/`**: lane K2's copy of the same walk
  (`docs/notebook/evidence/a11y-k2-keyboard-2026-09-28/`), whose README lists its three changes:
  the S2-13/S2-14 probes made able to answer (each with a case that must say "no"), and the editor
  doors reached through "More note actions" when D-3 moved them off the page.
  `keyboard-k2route-freshwalker/` re-runs its S2b with a walker whose notes no earlier walk had
  edited (`instrument/keyboard_walk_k2_ax.py`, one more shim: `AX_WALK_EMAIL`).

| record | steps | PASS | FAIL | OBSERVED |
|---|---|---|---|---|
| F4 (`0555889ef`), the scorecard's citation | 77 | 65 | 7 | 5 |
| **10E-2 unmodified, 2fb102c74** | 77 | 66 | 8 | 3 |
| **K2 route, 2fb102c74** (+ fresh-walker S2b) | 80 | **74** | **1** | 5 |

The C0 control (an unreachable button and a focus trap must be detected) PASSed in every run.

**F4's seven FAILs, row by row (K2 route at 2fb102c74):**

| row | F4 | now | note |
|---|---|---|---|
| **S2-23** Outline disclosure | FAIL | **PASS (fixed)** | on open, focus goes into it ("Close outline"); Tab stays inside; Escape returns to "Outline". PASS in BOTH instruments |
| S2-26 Export menu | FAIL | **PASS (fixed)** | reached through "More note actions"; focus goes to menuitem "Markdown" |
| S2-27 Open beside | FAIL | **PASS (fixed)** | focus goes to "Find a note to open beside"; Tab stays inside |
| S2-13 `[[` link | FAIL | **PASS** | K2's probe; S2-13b (keyboard selection) and S2-13c (Escape inserts nothing) PASS too |
| S2-14 `@date` | FAIL | **PASS** | K2's probe; its control S2-14c (`@notaday` stays text) PASS |
| S6-02-list (820) | FAIL | **PASS (fixed)** | 0 targets < 24 px |
| S6-02-editor (820) | FAIL | **PASS (fixed)** | 0 targets < 24 px |

**Graph (S3): unchanged and complete by keyboard.** S3-01 (the canvas is a named Tab stop,
"Note graph: 6 notes, 5 links"), S3-02 (Arrow/Home/End announce the selected note in the live
region), S3-04 (Enter opens the note) and S3-05 (Show as list) PASS in both instruments. S3-03 is
OBSERVED, as it was in F4 and K2: the canvas pixels after Escape differ from before the keys. It is
recorded for a reviewer and has no pass/fail line.

**Newly failing: none that is a product defect.** In detail:

- **10E-2 unmodified: S2-22, S2-26, S2-27, S2-28 "not reached"; S2-30, S2-31 (OBSERVED in F4)
  "not reached".** All six are doors that K2's D-3 moved behind "More note actions". This walk has
  no route through that disclosure, and **K2's route reaches and passes every one**. That is an
  instrument limit, not a regression. S2-13/S2-14 FAIL here because 10E-2's own probes cannot
  answer (K2's README: the link renders `<span data-note-link>`, and `@date` is an input rule, not
  a picker).
- **K2 route: S2-17** (leave a table by keyboard) FAILed on the walked note, which already held the
  first walk's table. ArrowDown x8 re-entered the older table. **With a fresh walker it PASSes**
  (`keyboard-k2route-freshwalker/walk-S2b.json`), and it PASSes in the unmodified walk too.
- **K2 route: S2-18** (move a block with Alt+Shift+Arrow, the 2.5.7 alternative to the drag grip)
  **FAILs, and the probe explains it as a timing artefact**:
  `instrument/s2_18_probe.py` → `s2-18-probe.json`, `s2-18-probe-r2.json`,
  `s2-18-probe-r3.json`. On the same note, the first block moves by keyboard when the body is
  reached by the walk's own Tab route (A), by focus (B), and after a replay of the walk's
  table-session keys (C). **Route D presses Ctrl+Home and Alt+Shift+ArrowDown back to back, as the
  walk does, and moves the wrong block (the caret was still in the table). Route E is D with 50 ms
  between the two keys, and it moves the first block.** The only variable is the gap. The
  mechanism is upstream: Ctrl+Home is a native caret move, which `prosemirror-view` 1.41.8 learns of
  only through the asynchronous `selectionchange`, and its keydown `forceFlush()` flushes only a
  flush already pending. So a keymap fired within the same task still reads the old selection. A
  person cannot press two keys within one browser task; a script or a macro can. It is recorded,
  not fixed: it is library behaviour and outside Notebook code. It also explains why S2-18 PASSes
  in the unmodified walk on this same tree.

→ **9d: every FAIL the scorecard cites (S2-23, S2-26, S2-27, S2-13, S2-14, S6-02 x2) PASSes at
`2fb102c74`, the graph rows PASS, and the one remaining FAIL is an explained instrument-timing
artefact.** Whether that is enough to move 9d to MET is the scorecard owner's call, not this lane's.

## Fixes made in this lane

**None.** Neither instrument found a small, clearly-scoped a11y defect in Notebook code. The one
open row (S2-18) is library timing behaviour, not a Notebook attribute or focus defect. No product
file was touched, `app/src/hub/` was not touched, and no durability-path file was touched.

## Sandbox integrity

Five boots, all through the perf harness's `Sandbox` (`scripts/hub_sandbox_boot.py`, census-pinned),
data dir `C:\data-w10ax`, port 8235. Each was **CLEAN at pre-boot, +15 s, +120 s and shutdown**
(62 db files hashed under `C:\data` each time). Logs: `docs/plans/joystick/sandbox-runs/2026-09-29T07-13-54.md`
(walk), `…T07-58-43.md` (gallery attempt 1), `…T08-08-03.md` (gallery), `…T08-14-02.md` (S2-18
probe); copies and the driver's verdicts are in `sandbox/`. Never `C:\data`, never port 8077.

## What this does NOT prove

- **No screen-reader pass.** Every name and role here was read from the DOM or the accessibility
  tree by a script. What NVDA / VoiceOver / TalkBack actually announce is the owner's pass.
- **9a is not re-measured at `2fb102c74`** beyond the gallery (see the refusal). F5's 123/123 is
  a reading of `aa2417c2c`, not of this tree. The phone Format disclosure, the phone More panel and
  the board fade have **no real-browser axe reading**.
- **The gallery reading is ONE theme** (the default). F5 read dark, oled and light.
- **axe finds only what axe finds.** 0 violations says nothing about axe `incomplete` items
  (contrast over translucent layers), which need a person.
- **The walk is Chromium only** (Playwright 145), and keyboard only. There is no Safari or Firefox
  focus behaviour and no real device. Touch rows S6 are geometry, not a finger.
- **S2-18's artefact analysis rests on one note in one browser.** It shows the gap is the variable
  (D vs E). It does not prove that no human-speed sequence could hit the same window.
