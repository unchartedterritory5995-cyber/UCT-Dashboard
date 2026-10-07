# Wave 13, lane 13X: the all-flags-on integration walk

Branch `feat/notebook-w13x`, worktree `C:\Users\Patrick\uct-worktrees\notebook-w13x`, from the
merged wave-12-into-wave-13 landing at `69355d3527`. Tip `22e677eb61`. This is a NEW lane, not a
per-feature one: its job is a single real-browser walk of the MERGED wave-13 Notebook with
**every** wave-13 feature flag on **at once**, to catch what the sixteen per-lane walks
(13A/13B/13C/13C-2/13D/13E-1/13E-2/13F/13G-1/13G-2/13H-1/13H-2/13I-1/13I-2/13J, plus the
already-armed wave-11 trio) cannot: features interfering with each other, a page rendering
differently with two flags on at once than either lane's own walk showed, and a shared file
(`ResearchHome.jsx`, `InsightsHub.jsx`, `plan_extract.py`, `note_levels.py`) merged correctly.

Instrument: `tools/notebook_w13x_walk.py`. Evidence: `docs/notebook/evidence/wave13-13x/walk-run{1..6}/`
(each a `walk.json` + screenshots + `sandbox.log`/`integrity.md`/`pre-seed-child.log`/
`post-seed-child.log`, all committed before being read — R-RAW).

## The 17 flags, all on at once

`NOTEBOOK_PLAN_GRADING_ENABLED` (13A) · `NOTEBOOK_ENTRY_CONTEXT_ENABLED` (13E) ·
`NOTEBOOK_EARNINGS_PREP_ENABLED` (13G-1) · `NOTEBOOK_CHART_PLAN_ENABLED` (13H) ·
`NOTEBOOK_TA_FINGERPRINT_ENABLED` (13I) · `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED` ·
`NOTEBOOK_PLAYBOOK_ENABLED` · `NOTEBOOK_THESIS_CHIPS_ENABLED` (13G-2) ·
`NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED` (13G-1) · `NOTEBOOK_PASSED_SETUPS_ENABLED` ·
`NOTEBOOK_SETUPS_BOARD_ENABLED` (13J) · `NOTEBOOK_FIND_SIMILAR_ENABLED` (13J) ·
`NOTEBOOK_REVIEW_DRAFTS_ENABLED` · `AWARENESS_NOTE_RESURFACE_ENABLED` (13D) ·
`NOTEBOOK_TRADE_CANVAS_ENABLED` · `NOTEBOOK_AI_ACTIONS_ENABLED` · `NOTEBOOK_FORMULAS_ENABLED`.
Checked each run via `W0_every_flag_on_at_once` against the sandbox's own `/api/auth/me` payload
— the gate is the auth payload, never a code default (CLAUDE.md flag-ledger rule).

## The one coherent story the walk seeds (real routes, not fixtures dropped into a DB)

One member, one trading day: an NVDA thesis note with chart-drawn entry/stop levels
(checkpointed v1), a second save adding the target line + a VCP setup tag + a technical
fingerprint (v2, live); a position entered against that plan (180/170) closed into a trade at
207.50 (clears `target − 0.25R`, so "Hit" under ruling P4) — the one position+trade pair that
feeds the entry-context card, 13A's plan grade, the before/after and the setups-board exclusion
rule off ONE seed; a "This week" watchlist holding AMD (reporting in 3 sessions, never traded,
so it scores as both "reporting soon" and a passed setup off the same name); a second, untouched
ZQVA "watching" note so the setups board has a surviving card and find-similar has a template to
match CRWD against (13J's own pinned arithmetic). Run 6 added a second, deliberately unplanned
IBM trade (no note on that ticker anywhere in the story) for the Unplanned-chip check (see below).

## Rows, as of run 6 (tip `22e677eb61`) — 17/17 PASS, sandbox integrity CLEAN through shutdown

`W0_every_flag_on_at_once` · `SEED_the_coherent_story` · `SEED_post_boot_jobs` ·
`W1_research_home_1200` · `W2_thesis_note_1200` · `W3_resurfacing_door_on_the_note` ·
`W4_position_and_thesis_chip_1200` · `W5_close_and_trade_page_1200` ·
`W5b_unplanned_chip_and_review_note` · `W6_insights_1200` · `W7_setups_board_1200` ·
`W8_earnings_prep_1200` · `W9_transcript_capture_door_1200` · `W10_passed_setups_1200` ·
`W11_phone_390` · `W12_no_unforced_errors` · `W13_driver_never_imported_api`.

`SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, post-prewarm
(+120s) CLEAN, shutdown CLEAN; 62 db files hashed` — true of runs 1, 2, 3, 4, 5 AND 6 (all six
reached the fourth, shutdown checkpoint; verified directly off each run's own `walk.json`
`integrity.checkpoints`, not summarized from memory). This is the opposite of 13A's own lane doc
finding (`docs/notebook/wave13-13a.md` §7): none of 13A's three walks reached a shutdown
checkpoint. Recorded here explicitly per the controller's instruction after that finding.

## Defects found, root-caused and fixed in this lane

1. **W11, 390px: the setups board's mini-chart exposed the shared A/L/% price-scale toggle at
   11px tall** (`BoardCard.jsx`), under the `--tap-min` touch floor. Root cause: `BoardCard.jsx`
   never passed `StockChart`'s `hideScaleToggle` veto, the same host-chrome-veto shape
   `TradeBeforeAfter.jsx` already uses for its own mini-charts. Fixed: added the prop + a unit
   assertion in `SetupsBoard.test.jsx` (`npx vitest run
   src/pages/journal-2-0/components/notebook/SetupsBoard.test.jsx
   src/pages/journal-2-0/lib/chartPlan.test.js --maxWorkers=1` → 2 files, 25 tests, green).
   Commit `bfc2fb3fc7`. Confirmed in a real browser by runs 4–6 (`small_controls: {}`).

2. **W2: `ChartPlanPanel` rendered zero role rows for a role-bearing annotation seeded in the
   flat `{role, price, ...}` shape** (the write interface's PRIMARY documented shape per
   `plan_extract.py`, points-only being the fallback). Root-caused and fixed by the other
   writer on this branch in `lib/chartPlan.js`'s `drawingLevelPrice()` (commit `4d8aeef226`,
   verified correct against `plan_extract.py::_annotation_price`'s identical precedence).
   **This did NOT resolve run 3's W2 FAIL, and the reason was NOT a further product defect**:
   `app/dist` was last built 09:33:51, the fix landed in source at 10:29:22, and run 3 launched
   at 10:30:33 — serving a bundle ~57 minutes older than the fix it was meant to prove. The
   tool's own header names this precondition ("app/dist rebuilt from this tree") and it was not
   met for run 3. Rebuilt (`npm run build`, 1m15s) and re-walked as run 4: `chart_plan_rows: 3`,
   `chart_plan_panel_error: null`. Confirmed again in runs 5 and 6.

3. **W12: the 7 `warm=1` background bars-prewarm 503s for other timeframes read as unexpected
   failures.** The `BENIGN_4XX_5XX` list's `"warm=1"` entry (added by the other writer, present
   on disk by run 3 but not reflected in run 3's own captured results for the same stale-dist
   reason as #2 — a code-vs-bundle mismatch, not a tool bug) is confirmed effective from run 4
   onward: `unexpected_failed_requests: []`, `benign_failed_requests_count: 30` (33 once run 6's
   own extra pages are counted).

## Controller's diagnostic questions — both answered definitively from source, not inferred

- **`POST /api/j2/broker/sync?background=1` 503 on every page.** Expected/by-design:
  `api/routers/broker_sync.py`'s `_guard_configured()` raises 503 ("Brokerage sync is not
  configured on this server") whenever `snap.is_configured()` is false, which it always is in
  this sandbox (no SnapTrade credentials seeded, deliberately — `BROKER_SYNC_ENABLED=0` is also
  in the kill list). Not a real failure; already correctly on the benign list.
- **Bars `tf != D` 503s.** Expected/by-design: only daily ("D") bars are seeded for NVDA/AMD/
  ZQVA(+B/C)/IBM. `api/routers/bars.py`'s "warming" contract answers 503 + `Retry-After` +
  `bars: []` for a (ticker, tf) pair with nothing on disk — not an error, a documented
  not-yet-warm state. The chart's own D-tf request is the one that must succeed, and does, on
  every seeded symbol including IBM (seeded in run 6 — see below).
- **"EntryContextCard not appearing on position/trade pages with every flag on."** Not
  reproduced in this lane at any point: `W4_position_and_thesis_chip_1200` and
  `W5_close_and_trade_page_1200` both PASS on every run (1 through 6), each explicitly waiting
  for `[data-testid="entry-context-card"]` to be visible before reading it. No interaction bug
  found between this card and any other wave-13 surface.
- **"My Playbook / Insights discipline / earnings-prep entry not rendering."** Not reproduced:
  `W6_insights_1200` (all three Insights sections, including Discipline, present) and
  `W8_earnings_prep_1200` both PASS on every run from run 3 onward (run 2's one-time discipline
  false-negative was diagnosed as a race on the section's own async data fetch, not a defect,
  and fixed in the walk's own wait logic — see the tool's RUN 1/2 FINDINGS header comment).

## 13A's surfaces — added per controller add-on, after 13A's own lane doc

13A's lane doc (`docs/notebook/wave13-13a.md` §7) found that all three of its own walks left
the sandbox-integrity "shutdown" checkpoint unreached, and asked this integration lane to
explicitly cover plan grade card, discipline record, the Unplanned chip and the review note,
and to itself reach a clean shutdown.

- **Plan grade card** — `W5_close_and_trade_page_1200`, already covered: `data-testid=
  "plan-grade-card"`, four checks rendered (`entry: kept`, `stop: kept`, `size: none`,
  `target: hit`), the frozen-plan sentence, before/after present.
- **Discipline record** — `W6_insights_1200`, already covered: `data-testid=
  "discipline-record"` waited-for and visible; also probed for sub-44px controls at 390px in
  `W11` (none found).
- **The Unplanned chip and the review note** — NOT covered before this lane doc was written;
  added as a new step `W5b_unplanned_chip_and_review_note` (commit `22e677eb61`):
  - A second closed trade (IBM, 10 shares, 200→205) with no note on that ticker anywhere in the
    seeded story, so 13A's 30-day-window matcher has nothing to link it to. Confirmed the
    `data-testid="unplanned-chip"` renders on the Trade Journal's closed-trades table
    (`/journal/trades?seg=closed`) AND the matching `data-testid="plan-grade-unplanned"` badge
    on that trade's own page, AND that `GET /api/j2/plan-grades/status` answers
    `unplanned`/`planned` correctly for the two trades side by side.
  - Clicked "Write review note" on the NVDA trade `W5` already graded `planned`, waited for the
    navigation to carry a `note=` id, and read the created note back via
    `GET /api/j2/notes/{id}` to confirm its `tags` include `plan-review` (`planReview.js`'s
    `REVIEW_TAG`) — the one invariant that keeps a review note from being misread as the NEXT
    trade's plan.
  - **Run 5 (raw, FAIL, kept as written — R-RAW):** two bugs in the new walk code itself, not
    the product — `GET /api/j2/plan-grades/status` nests its answer under `"statuses"`
    (`notebook_plan_grades.py:110`) and `GET /api/j2/notes/{id}` nests under `"note"`
    (`journal_two.py:3208`); the first draft read both top-level and got `null`/`[]`. A third,
    real gap: IBM had no seeded daily bars, so its own trade page's chart 503'd on the plain
    D-tf request — not a `warm=1` pre-warm, so correctly outside the existing benign-list entry,
    and not the dead-ticker-503 warming contract either (that contract is for an UNSEEDED
    symbol; closing the gap by widening the benign list would have hidden a real missing-seed
    bug for any future symbol this lane adds). Closed by seeding one bar for IBM, matching
    ZQVA/B/C's existing minimal shape, not by touching `BENIGN_4XX_5XX`.
  - **Run 6 (raw, PASS — R-RAW):** all three fixed. `chip_present: true`, `badge_present: true`,
    `planned_status: "planned"`, `unplanned_status: "unplanned"`, `review_note_tags:
    ["plan-review"]`. 17/17 rows PASS, sandbox integrity CLEAN through shutdown.

## Files touched by this lane

- `tools/notebook_w13x_walk.py` — the instrument (kept as the base per controller instruction,
  `68f2c4b646`; W5b added `22e677eb61`).
- `app/src/pages/journal-2-0/components/notebook/BoardCard.jsx` — `hideScaleToggle` prop
  (`bfc2fb3fc7`).
- `app/src/pages/journal-2-0/components/notebook/SetupsBoard.test.jsx` — the matching unit
  assertion (`bfc2fb3fc7`).
- `app/src/pages/journal-2-0/lib/chartPlan.js` — `drawingLevelPrice()` precedence fix (the other
  writer's commit `4d8aeef226`, verified correct here against the backend's reader).

## What this lane does NOT own, and did not fix

No defect was found in this walk that lives in a file owned by a currently-running lane
(13Q-4's Journal tab bar/NavBar, 13Q-5's template picker/bulk bar, 13H-4's StockChart/chart
embed internals, 13SC's docs/scorecard). Nothing is deferred to them from this report.

## Evidence index

| run | tip | verdict | notes |
|---|---|---|---|
| 1 | `69355d3527` | mixed | first version of the tool; `68f2c4b646` |
| 2 | — | mixed | W1/W6/W8/W9/W10 FAIL/INCONCLUSIVE, resolved without a targeted fix in run 3 (resource contention, not a product defect — box was under heavy concurrent load) |
| 3 | `run3` | W2/W11/W12 FAIL | both fixes (#2 above, `bfc2fb3fc7`) already committed but NOT in the served bundle (stale `app/dist`, see finding #2) |
| 4 | `bfc2fb3fc7` | 16/16 PASS | `app/dist` rebuilt; confirms #1, #2, #3 all fixed |
| 5 | `run5` | 15/17 PASS, 2 FAIL | W5b added; both FAILs were bugs in the new walk code (see above), kept as written (R-RAW) |
| 6 | `run6` | **17/17 PASS** | both walk-code bugs fixed + IBM bars seeded; current state |

Tip at report time: `22e677eb61`.
