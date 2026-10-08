# Wave 13, lane 13Q-1: the click-by-click usability instrument, and the first measurement

Branch `feat/notebook-w13q`. Spec: `docs/notebook/WAVE-13-PLAN.md` section 6 ("13Q: the
click-by-click program") and the 23 budgets under it; lane text Appendix A is not separately
spelled out for 13Q (section 6 IS the spec). Instrument: `tools/notebook_w13q_clicks.py`
(committed at `f75f2d8f1b`). Unit tests for the instrument's own counting/verdict logic:
`tests/test_notebook_w13q_clicks.py` (new in this lane, 29 passed).

**This lane builds and runs the instrument; it does not fix anything the instrument finds.**
Per the plan: "A miss is a finding with its raw path, never an edit to the target. 13Q-2 fixes
misses through the owning lane's files." No product file is touched here.

## 1. The run read for this report

Raw evidence: `docs/notebook/evidence/wave13-13q/run-f75f2d8f1b/` (committed before being read,
R-RAW — it landed pre-built by the prior agent, stopped by the account weekly limit before it
could read its own output; this report is that reading). Contents: `clicks.json` (the full
record — every row, every counted step, every Tab-run focus trail), `table.md` (the same rows as
a markdown table), `integrity.md`, `sandbox.log`, `seed-child.log`, and one screenshot per
row that reached a page.

- **Run status: `COMPLETE`**, `partial: {flows: null, modes: null}` — every one of the 23 flows
  was attempted in every applicable mode (mouse@1200, keys@1200, keys@390, taps@390). **All 23
  budgets are covered**; nothing needed extending or re-running (the brief's "if the run covered
  fewer than all budgets, extend and re-run" does not apply here).
- **Integrity: CLEAN** at pre-boot, +15 s, +120 s and shutdown — 62 `C:\data` files hashed each
  time, unchanged. The run never touched the shared data root (`integrity.md`).
- `driver_imported_api: []` — the driver's own `sys.modules` assertion: it never imported
  `api.*`, as the instrument's header requires.
- `page_errors: []` — no uncaught page error across all 92 rows.
- Started `2026-10-03T03:00:16Z`, finished `2026-10-03T03:39:21Z` (~39 min, 92 rows).
- Sandbox flags armed (sandbox child process only, never the real auth payload shape outside
  it): `notebook_ask_insert_on`, `notebook_earnings_prep_enabled`, `notebook_plan_grading_enabled`,
  `notebook_template_gallery_enabled` — all `True`; every other `NOTEBOOK_*` flag the live
  `/api/auth/me` payload carries read its normal default (`auth_me_flags` in `clicks.json`).

**Totals across the 92 (flow × mode × width) measurements:** 24 PASS, 26 OVER, 42 INCONCLUSIVE.
A flow/mode never reads PASS or OVER unless its outcome was independently verified (the note
really has the ticker, the export really downloaded a `.docx`, ...) — INCONCLUSIVE is the only
reading for a flow whose surface is dark/unbuilt on this tree or that the driver could not
finish, and a capped Tab run reads OVER with "cap reached", never a silent PASS (both rules are
now also unit-tested directly against the instrument's code — section 4).

### Tree note: this worktree does not carry every wave-13 lane

Of the 42 INCONCLUSIVE readings, 32 (Q14, Q16-Q19, Q21-Q23, all 4 modes each) are a dark/unbuilt
surface on **this** tree — grepped to a missing route or a missing flag, not guessed (e.g. Q14:
"no route, no flag `NOTEBOOK_PLAYBOOK_ENABLED` in `api/routers/auth.py`"). Q20's three
INCONCLUSIVE rows are a deliberate split within one flow: 13H-1 (schema + routes) is on this
tree, 13H-2 (the chart-markup UI the rest of Q20 needs) is not, so the instrument measures the
insert-a-chart portion only and reads INCONCLUSIVE for the remainder by design, not by failure.
This means lanes 13A, 13H-1 and 13I-1 (plus Notebook core/capture/export/Ask and 13C-1) are the
only product surfaces this run could measure against; the plan's own dispatch order has 13H-2
landing before 13Q-1, so either this worktree is a step behind that sequencing or 13H-2 has not
yet merged into the `w13-landing` lineage this branch forked from — stated as a tree fact, not
chased further (out of scope for 13Q-1).

## 2. Ruling P5, re-measured: the "337 Tabs" claim

**Reproduced, and the real number is close enough to call it the same finding.** Q7 is the
plan's named control, measured only (`app/src/pages/screener/shell/ScannerShell.jsx`'s "Save
these results to Notebook" door, Screener-owned):

| width | real Tab presses | + activation keystroke | counted total (keys mode) | budget | verdict |
|---|---|---|---|---|---|
| 1200 px | **339** | 1 (Enter) | **340** | 10 | OVER |
| 390 px | **32** | 1 (Enter) | **33** | 10 | OVER |

339 real Tab presses at 1200 px is 2 away from the claimed "~337" — within the claim's own "~",
and the small gap is plausibly ordinary path variance (a differently seeded note list, a
differently sized screener result set) rather than the claim being wrong. **P5's finding stands,
measured fresh on this tree, and is 34x the flow's 10-keystroke budget.** The mouse and taps
readings for the same flow are both PASS (1 click / 1 tap, budget 3) — the Tab-order length is a
keyboard-only defect, invisible to a pointer walk, which is exactly why the plan called for all
three modes rather than trusting one. Raw trail (every one of the 339 presses, with the focused
element's tag/role/name at each step): `clicks.json` → `rows[]` where `flow=="Q7"` and
`mode=="keys"` → `steps[-1].trail`.

## 3. Every budget, measured

One row per flow (the plan's own 23), each cell `measured/budget` then the verdict. A flow not
built on this tree reads `INCONCLUSIVE` across the row (its one note explains why, and is not
repeated in every cell). **Owner** is the lane that would fix an OVER, read from the instrument's
own `BUDGETS` table (section 6 of the plan, cross-checked — section 4). **Surface** names the
actual door the flow drives through, read from the flow function itself, not guessed.

| # | flow | owner | surface | mouse@1200 | keys@1200 | keys@390 | taps@390 |
|---|---|---|---|---|---|---|---|
| Q1 | new blank note, cursor in body | Notebook core | NotebookTab: command palette (`Ctrl+K` → New Note) / All Notes "+ New note" | 3/2 **OVER** | 6/3 **OVER** | 6/3 **OVER** | 3/2 **OVER** |
| Q2 | new note from a template with a ticker | Notebook templates (12B) | NotebookTab: "Templates" dialog, template card, Ticker field | 5/4 **OVER** | 201/6 **OVER** | 124/6 **OVER** | 5/4 **OVER** |
| Q3 | open a note by title | Notebook core | NotebookTab: command palette / note list row | 2/2 PASS | 2/4 PASS | 2/4 PASS | 1/3 PASS |
| Q4 | search, open a hit | Notebook core | NotebookTab: "Search notes" panel | 2/3 PASS | INCONCLUSIVE¹ | 19/5 **OVER** | 2/3 PASS |
| Q5 | today's daily note | Notebook core | NotebookTab: `Ctrl+Alt+D` / All Notes "Today" button | 2/1 **OVER** | 1/2 PASS | 1/2 PASS | 2/1 **OVER** |
| Q6 | link a note to a trade | Notebook core / Journal | Journal → Trades tab → Closed → trade view → "Save to Notebook" | INCONCLUSIVE² | INCONCLUSIVE² | INCONCLUSIVE² | INCONCLUSIVE² |
| **Q7** | **save Screener results to a note (337 Tabs, ruling P5 — section 2)** | Screener (`ScannerShell.jsx`) | `/screener` "Save these results to Notebook" button | 1/3 PASS | 340/10 **OVER** | 33/10 **OVER** | 1/3 PASS |
| Q8 | save a price or consensus fact | Notebook capture | NotebookTab editor: `/price` slash command | 1/3 PASS | 3/8 PASS | 3/8 PASS | 1/3 PASS |
| Q9 | ask the Notebook, insert the answer | Notebook Ask | NotebookTab: Ask panel (`[data-ask-toggle]`) → Insert into this note | 3/3 PASS | 91/5 **OVER** | 34/5 **OVER** | 3/3 PASS |
| Q10 | task with a due date | Notebook core | NotebookTab editor: `/checklist` + `@` date mention | 1/2 PASS | 4/4 PASS | 4/4 PASS | 1/3 PASS |
| Q11 | tag and move 5 notes | Notebook core | NotebookTab: All Notes bulk-select bar (Tags, Move to) | 12/8 **OVER** | 513/15 **OVER** | 477/15 **OVER** | 12/10 **OVER** |
| Q12 | export one note as Word | Notebook export | NotebookTab: "More note actions" → Export → Word (.docx) | 3/3 PASS | 117/6 **OVER** | 41/6 **OVER** | 3/3 PASS |
| Q13 | plan grade of my last trade (13A) | 13A | Journal → Trades tab → Closed → trade row → plan-grade card | 3/2 **OVER** | 666/4 **OVER**³ | INCONCLUSIVE² | INCONCLUSIVE² |
| Q14 | My Playbook, drill a number (13B) | 13B | — (13B not on this tree) | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Q15 | create earnings prep (13C) | 13C | NotebookTab: Research Home "Create prep note for NVDA" | 1/2 PASS | 97/5 **OVER** | 74/5 **OVER** | 1/2 PASS |
| Q16 | open a resurfaced note (13D) | 13D | — (13D not on this tree) | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Q17 | answer "why did you take it" (13E) | 13E | — (13E not on this tree) | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Q18 | draft this week's review, open a leak (13F) | 13F | — (13F not on this tree) | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Q19 | save a transcript passage to a thesis (13G) | 13G | — (13G not on this tree) | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Q20 | insert a chart, draw entry/stop/target, read size (13H) | 13H | NotebookTab editor: "Insert widget" → Chart (insert-only; draw/alert is 13H-2, not on this tree) | INCONCLUSIVE⁴ | INCONCLUSIVE⁴ | 650/10 **OVER**³ | INCONCLUSIVE⁴ |
| Q21 | arm an alert at a drawn stop (13H) | 13H | — (needs 13H-2's chart-plan UI) | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Q22 | filter the visual playbook to one setup (13I) | 13I | — (13I-2 not on this tree) | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Q23 | morning board, open closest setup, find similar (13J) | 13J | — (13J not on this tree) | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |

¹ Driver timeout waiting for navigation (30 s), not a dark lane — `clicks.json` row
`Q4/keys/1200`. ² See section 3a below — a Trades-surface reachability finding, not a dark
lane. ³ A capped Tab run: 600 real presses, control never reached — OVER with "cap reached",
the Tab-order length itself is the finding. ⁴ By design: the insert-a-chart portion alone was
measured (3, 141 and 4 presses respectively, chart inserted each time) and the row then reads
INCONCLUSIVE because the rest of Q20 is 13H-2, not on this tree — see `clicks.json` reasons.

### 3a. Q6 and Q13: a Trades-surface reachability finding, not (only) "lane not built"

Unlike Q14/16-19/21-23, Q6 and Q13 are NOT dark lanes — 13A (Q13's plan-grade card) and the
Journal's Trades surface are both on this tree and were seeded successfully (`seed.trade_id`,
`seed.plan_trade_id` both HTTP 200 in `clicks.json`'s `seed` block). What the instrument found,
by mode, at the SAME seeded trade:

- **Mouse@1200 (Q6):** reached the Trades tab, found the CRWD row, opened it — then found no
  "Save to Notebook" button within 15 s on the view the row opened (`clicks.json`:
  `Q6/mouse/1200`, URL unchanged at `.../journal/trades?seg=closed`, implying a drawer opened in
  place rather than a route change).
- **Keys@1200 and keys@390 (Q6), keys@390 (Q13):** the row-locator (`tr`, or a `button`/`a`/
  `[role=row]`/`li` containing the symbol — code comment: "whatever control names the symbol on
  a phone layout") returned zero matches, even at 1200 px where the mouse mode found it one step
  earlier in the same flow.
- **Keys@1200 (Q13):** the row WAS found (the locator resolved an element handle), but 600 real
  Tab presses never reached it — a `Capped`, read as OVER (the "666/4 OVER" row above).

This is a genuine signal worth the next session's attention, but this lane does not chase it
further: it would mean either tightening the instrument's own row-locator (plausible — the
Journal's closed-trades table renders cards, not `<tr>`s, under 640 px per
`app/src/pages/journal-2-0/components/TradesTable.jsx`'s `TradeCard`, a `<button
data-testid="trade-card">` the instrument's `alt` locator already matches on `tag=button`, so
the miss is not simply "wrong tag") or a real Journal-side keyboard-reachability gap on the
Trades surface — and distinguishing the two needs a live debugging session against the
sandbox, which is out of scope for "build the instrument and read its first run." Recorded here,
with the raw trail cited, for 13Q-2 or the Journal owner to pick up.

## 4. Unit tests for the instrument's own logic

New: `tests/test_notebook_w13q_clicks.py`. Run: `python -m pytest
tests/test_notebook_w13q_clicks.py -q` → **29 passed** (no browser, no sandbox — pure fakes for
the Playwright surface: a fake keyboard, locator, page, context and browser).

What it proves, against the instrument's REAL code (`tools/notebook_w13q_clicks.py`), not a
reimplementation of it:

- **`Meter` counts on the right bucket per mode** — clicks only move in mouse mode, taps only in
  taps mode, keys mode sums keystrokes and real Tab presses kept on SEPARATE counters (the
  plan's rule), and content typed via `type()`/`fill()` is never counted in any mode.
- **`Meter.tab_to` is the real loop**, not a stand-in: found immediately (0 presses), found after
  N real presses with a trail entry per press, Shift+Tab when asked, and — **the control this
  lane's brief specifically asks for** — never found within the cap raises `Capped` after
  pressing exactly `cap` times, never fewer, never forever
  (`test_tab_to_never_found_raises_Capped_rather_than_returning_quietly`), with a boundary case
  one press short of success (`test_tab_to_cap_is_exact_one_short_of_found_still_caps`).
- **`run_one`'s verdict, end to end**, against fakes for the browser/context/page: under budget →
  PASS; exactly at budget → PASS (the boundary is `<=`, not `<`); **over budget → OVER** (the
  non-vacuity control: an instrument that always answered PASS would clear every other test in
  this file and only this one would catch it — proved at +1 over budget and again at 12x over,
  so it is not merely clamped); a capped Tab run → OVER with a "cap reached" reason, never a
  silent PASS; a raised `Inconclusive` → INCONCLUSIVE regardless of how few actions were counted
  first (never PASS/OVER on a technicality); a generic driver exception (the Q4-class timeout) →
  INCONCLUSIVE, never an uncaught crash; and an `unbuilt` flow short-circuits to INCONCLUSIVE
  **before the instrument ever opens a browser context** — proved by passing `br=None`, which
  would raise `AttributeError` the instant anything tried to use it.
- **`table_md`** renders a missing `measured` (every INCONCLUSIVE row) as `-` rather than
  crashing, and sanitizes a `|` or a newline inside a reason so an embedded error message can
  never break the table's own column count.
- **The 23 budgets cannot silently drift from the plan.** `BUDGETS` in the instrument is
  cross-read against `docs/notebook/WAVE-13-PLAN.md` section 6's own table (parsed directly, not
  retyped), with a non-vacuity control (`len() == 23`) guarding the parser itself — a regex that
  matched nothing would otherwise let the drift check pass by comparing two empty sets.

## 5. What this lane did NOT do

- No product code was touched — not `ScannerShell.jsx`, not the Journal's Trades surface, not
  the Notebook editor. Every OVER and every reachability finding above is a reading, handed to
  13Q-2 (or the owning lane) to fix.
- No extension of the run: all 23 budgets were already covered (`status: COMPLETE`,
  `partial: null/null`), so there was nothing to extend.
- No mutation proofs and no dark-flag registration: per the resume brief, those apply only when
  a lane adds a guard or a capability. This lane added neither — it added an instrument (already
  built, by the prior agent) and a reading of its first run, plus unit tests for the instrument's
  own arithmetic.

## 6. Evidence paths

- Raw run: `docs/notebook/evidence/wave13-13q/run-f75f2d8f1b/` (`clicks.json`, `table.md`,
  `integrity.md`, `sandbox.log`, `seed-child.log`, per-row screenshots).
- Instrument: `tools/notebook_w13q_clicks.py` (`f75f2d8f1b`).
- Instrument's own rails: `tests/test_notebook_w13q_clicks.py` — `python -m pytest
  tests/test_notebook_w13q_clicks.py -q` → 29 passed.
