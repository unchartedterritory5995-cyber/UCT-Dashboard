# Wave 13, lane 13F: reviews that write themselves, with the leak finder

Branch `feat/notebook-w13f`, tip `6c95593ca8de6597acf3b2066015854d1076ff6a`. Spec:
`docs/notebook/WAVE-13-PLAN.md` Appendix A.13F. Flag `NOTEBOOK_REVIEW_DRAFTS_ENABLED`,
unset = OFF.

## 1. What shipped

One click drafts a daily / weekly / monthly review — trades and P&L, the discipline
record, setup changes, links to plans/reviews/resurfaced notes, frozen charts of the
best and worst trade, and any leaks — assembled entirely from numbers that already
have a single authority elsewhere in the Notebook. Four doors: EODRecap.jsx
("Draft in today's note"), CompassReview.jsx ("Draft weekly review note"), Insights →
Reviews (all three periods), and Home (ResearchHome.jsx, all three periods). The
Compass quote is shown only when the payload carries one, as a G-064 ask-insert block
labelled "From Ask Notebook". The leak finder runs eight detectors, each finding
stating its sample (R3 wording), its dollar impact, and the exact trades it rests on.
No model client is reachable anywhere in this lane's own code; no background drafts;
no duplicate stats — every number is read off an existing authority, never recomputed.

| file | what it is |
|---|---|
| `api/services/journal_two/leak_finder.py` | pure detectors (no DB/clock/model); `baseline_stats` + `find_leaks` + 8 private detectors + the one finding-shape builder |
| `api/services/journal_two/review_drafts.py` | the orchestrator: fetch → enrich → aggregate (reusing `coach_data_assembler`) → discipline/setup-changes/links/best-worst/Compass-excerpt → assemble |
| `api/routers/notebook_review_drafts.py` | `GET /api/j2/review-drafts/{daily,weekly,monthly}`, router-level 404 gate |
| `api/services/journal_two/verdict_scorecard.py` | one additive export, `verdict_label_from_context = _verdict_from_context` (reused, not restated) |
| `app/src/pages/journal-2-0/lib/reviewDrafts.js` | the doc builder (`buildDraftBlocks`) + the two create-door orchestrators (`draftWeeklyReview`/`draftMonthlyReview`/`draftDailyReview`) |
| `app/src/pages/journal-2-0/components/EODRecap.jsx` | the daily door: appends into the member's own daily note via `openDailyNote()` + a CAS-protected PUT |
| `app/src/pages/journal-2-0/components/CompassReview.jsx` | the weekly door |
| `app/src/pages/journal-2-0/components/insights/InsightsHub.jsx` | the Insights → Reviews section, all three periods, new tab gated on the flag |
| `app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx` | the Home door (`ReviewDraftsHomeBox`), all three periods |
| `app/src/pages/journal-2-0/tabs/CompassTab.jsx` | two one-line additions: `accountId` threaded to EODRecap/CompassReview |
| `tools/notebook_w13f_mutation_proof.py` | the lane's 16-mutation proof |
| `tools/notebook_w13f_walk.py` | the lane's real-browser walk |

Flag roster rows (all present): `api/routers/auth.py` `NOTEBOOK_FLAGS`,
`app/src/pages/journal-2-0/lib/offline/notebookFlags.js` `FLAG_FALLBACKS`,
`tests/test_notebook_flags.py`, `tests/test_notebook_flag_parse.py`,
`tools/notebook_switch_rehearsal.py`, `docs/feature_flags.json` (dark),
`docs/notebook/security-review-notebook-routes.md` census row.

No file outside `journal-2-0/` notebook surfaces, the `journal_two/` services, the one
new router, `api/main.py`'s mount, `api/routers/auth.py`'s flag row, and the flag-roster
append points above was touched.

## 2. The leak finder

`find_leaks(trades, *, baseline, verdict_scorecard=None, suppressed_revenge_pairs=frozenset())`
runs eight detectors (revenge re-entry, sizing up after a loss, a weak time window,
regime at entry, held into earnings, SKIP overridden, unplanned, stops not honoured),
each going through the ONE finding-shape builder (`_finding`). A finding is returned
only when it has at least one `rMultiple`-bearing trade to cite — a finding with
nothing to cite is `None`, never a placeholder (mutation F2). Every finding's
`dollarImpact.netPnl` is the sum of `pnlDollarNet` over exactly its own cited trades
(mutation F1) and its `sample` uses `sample_size.mean_stat` (R3 wording — "too few to
judge" below n=10, a range at 10-24, plain at 25+), reused from 13B's module rather
than restated.

The size-up-after-a-loss detector is guarded against a broker placeholder stop
(`placeholder_stop.is_placeholder_stop`, a real tolerance window, not exact equality —
proved with a NEAR-placeholder, huge-share fixture after the first mutation run showed
the obvious exact-equality fixture could not distinguish the guard from the detector's
own `risk > 0` floor). The frozen trade charts reuse the existing `widgetSlotNode`
builder with an explicit `annotations: []` override, so a frozen chart never inherits
a symbol's live workspace drawings (proved the same way — a clean test environment's
real `peekDrawings()` already returns `[]`, so the test had to mock a real drawing to
make the override's removal observable).

## 3. Decisions (this lane's own, for the controller)

1. **"The daily note" door is EODRecap.jsx's button landing content INTO the member's
   existing daily note**, via `openDailyNote()` + a CAS-protected `PUT` (the same
   compare-and-set every note save uses — a concurrent edit is refused with a
   conflict, never silently clobbered). The file-ownership row names no separate file
   for "the daily note" door, so this is the only door shape that fits: weekly and
   monthly create a NEW tagged note through the Notebook's one create door; daily
   appends to the ONE note a day already has.
2. **Monthly aggregation reuses `coach_data_assembler`'s own private primitives**
   (`_trades_in_range` / `_aggregate_trades`, `# noqa: SLF001`) rather than
   reimplementing the arithmetic — there is no `assemble_month`, and 13B already set
   the precedent of reusing a sibling module's "private" helper when it is the single
   authority (`playbook_patterns.py` reusing `plan_grading._note_state_at`).
3. **No new a11y-manifest entry.** `a11y/population.js` scopes the Notebook-only a11y
   population to `components/notebook/*.jsx` top-level, `export/`/`import/`, and
   `tabs/NotebookTab.jsx` — none of EODRecap.jsx, CompassReview.jsx, InsightsHub.jsx or
   CompassTab.jsx are in it, and ResearchHome.jsx (which is) needed no new entry
   because no new FILE was added there, only a function inside it. Verified by running
   `a11y/surfaceCoverage.test.js` (13/13) and `a11y/researchCapture.a11y.test.jsx`
   (6/6, 0 axe violations) with this lane's changes in place.
4. **Compass-review generation as a walk precondition, never inside this lane's own
   code.** W1 of the real-browser walk calls the pre-existing, independently-tested
   `POST /api/j2/accounts/{id}/coach/weekly-reviews/generate` once, for real, so the
   walked week has a genuine Compass review to quote. This is the one and only place
   this lane's evidence touches a model client — `leak_finder.py` and
   `review_drafts.py` reach no model client anywhere, and the walk documents the
   exception rather than hiding it. In this environment (no `ANTHROPIC_API_KEY`) the
   call answers 503, which the walk records as a precondition failure, not a
   fabricated pass — the Compass-specific check (W3b) reads INCONCLUSIVE and the
   draft/leak checks, which do not depend on it, still get their own real verdicts.

## 4. Mutation proof

`tools/notebook_w13f_mutation_proof.py` — 16 mutations across `leak_finder.py`,
`review_drafts.py`, the router, `lib/reviewDrafts.js`, and the two UI doors' own flag
gates. Same discipline as 13B's harness: each mutation applied to the CAPTURED bytes
of one file, the named rail files run whole (never `-k` / `vitest -t`), a mutation
counts as killed only when the run reports at least one failed test, every restore
writes back the captured bytes and is verified against `git cat-file blob
HEAD:<path>` (LF-normalised) — never `git checkout`. An unmutated control runs green
before and after.

**First run** (`docs/notebook/evidence/wave13-13f/mutation-20577dbd2a-FAIL.txt`, kept
for history): 14 of 16 killed; **S1 and C1 SURVIVED**, both traced to real test gaps
rather than equivalent mutants (see §2 above for what each guard actually does) and
closed by strengthening their fixtures, not by changing the guarded code.

**Re-run, clean** (`docs/notebook/evidence/wave13-13f/mutation-4a5d530d5e.txt`): 16 of
16 killed.

**Final re-run at the lane's true tip**
(`docs/notebook/evidence/wave13-13f/mutation-6c95593ca8de6597acf3b2066015854d1076ff6a.txt`),
after the touch-target and walk-tool fixes in §5 below (no mutation-target line in any
covered file changed — confirmed by occurrence count before running): **16 of 16
killed**, every restore verified against the committed blob, `git status` over `api/`
and `app/src` clean after the run. `VERDICT: PASS`.

## 5. Real-browser walk

`tools/notebook_w13f_walk.py`, sandboxed via `tools/notebook_perf_harness.Sandbox`
(ports 8660-8664), `app/dist` built at the lane's tip. Seeds four closed trades over
one week the way a member actually would: an NVDA loss (10:00-10:30 ET), a same-symbol
re-entry 15 minutes later (10:45-11:15, same-day revenge pair, both losses), then an
AAPL and a TSLA win later in the week — a real net P&L (-$200.00) and a baseline the
revenge pair reads worse than.

**Three bugs found across the first two runs, each root-caused by reading the actual
rendered/persisted source rather than guessing, and each fixed before the final run:**

1. The three "Draft this week" button locators used a straight ASCII apostrophe; the
   rendered JSX uses U+2019 (curly). Playwright does literal substring matching, so
   they never matched — fixed to an apostrophe-free substring.
2. The numbers check compared against `"-200.00"` but `reviewDrafts.js`'s `fmtDollar()`
   renders the sign BEFORE the dollar sign (`"-$200.00"`) — fixed to replicate the
   exact format.
3. The leak-opening check tried to click the `<summary>` element; `toggleNode.js`
   intentionally `preventDefault()`s a summary click (so placing a text cursor there
   cannot collapse the block) and exposes only a chevron `<button>` as the real
   toggle, with `data-open` as the ground truth — fixed to click the chevron and
   assert the attribute transition.

**A fourth bug, found in the FIRST fully-green-looking run** (all checks that could
run did, but W3 and W5 still failed): W1 seeded its revenge-pair week 14 days in the
past, but the ONE "Draft this week's review" button in the product always targets
`mondayOfIso()` of right now (no date parameter) — so the walk created a real note for
an EMPTY current week while asserting against the seeded, never-rendered past week.
Root-caused via a `body_text_excerpt` diagnostic on the actual persisted note (not
assumed): the note's own heading read "Week of Sep 28" and its own numbers table read
"Trades taken: 0" against a walk that thought it had seeded "2026-09-14". Fixed by
seeding the CURRENT week instead, with every trade-date offset clamped to a day that
has already happened (so the walk works whichever weekday it is run on).

**A fifth, genuine product gap, found by the walk doing its job:** W5 (390px) first
failed on three REAL sub-44px controls — the Reviews tab's own three draft buttons in
`InsightsHub.jsx` had no touch-target sizing at all, and the equivalent single buttons
in `EODRecap.jsx`/`CompassReview.jsx` inherited the existing small "ghost" chrome-row
style with nothing raising them past the floor. Fixed with
`className="touchTarget"` (the existing `--tap-min: 44px` utility, globally imported)
on exactly the four new buttons this lane added — not the shared ghost style or its
pre-existing (out-of-scope) neighbours (Regen/Forget). `ResearchHome.jsx`'s three Home
buttons needed no change: they already use the shared `.btn` class, whose own
stylesheet applies the 44px floor at ≤640px.

**Flag-ON pass, `docs/notebook/evidence/wave13-13f/walk-6c95593ca8de6597acf3b2066015854d1076ff6a/`:**

| check | result |
|---|---|
| W0 gate + identity | payload flag true |
| W1 seed | 4 trades, Compass weekly-review generation attempted (HTTP 503 in this environment — no `ANTHROPIC_API_KEY`; recorded, never fabricated) |
| W2 draft from Insights → Reviews (1200px) | lands on the new note |
| W3 note numbers, leak, Compass | net P&L `-$200.00` on the page (matches the API's own aggregate); the revenge-reentry leak toggle present, OPENS on the chevron click (`data-open` false → true), revealing its cited NVDA trade |
| W3b Compass label | **INCONCLUSIVE** — the seeding call to the pre-existing Compass generator did not succeed in this environment; the draft/leak checks, which do not depend on it, still PASS on their own |
| W4 keyboard | Tab reaches "Draft this week's review" in 2 presses, Enter fires it |
| W5 390px (touch) | the Reviews section's own probe: no sideways scroll, zero sub-44px controls; the landed note page: no sideways scroll |
| W6 no page errors | none |

Sandbox integrity: **CLEAN** at pre-boot, +15s, +120s and shutdown; 62 db files
hashed.

**Flag-OFF pass, same directory (`walk-off.json`):**

| check | result |
|---|---|
| F0 payload flag off | `notebook_review_drafts_enabled: false` |
| F1 all three routes 404 | daily/weekly/monthly all 404 |
| F2 no Reviews tab in Insights | 0 `Reviews` buttons |
| W6 no page errors | none |

Sandbox integrity: **CLEAN** at pre-boot, +15s, +120s and shutdown; 62 db files
hashed.

## 6. Open items

* **W3b (Compass label) is INCONCLUSIVE, not PASS**, purely an environment limitation
  (no `ANTHROPIC_API_KEY` reachable from this walk's sandbox) — the code path it would
  exercise (`compassSection` → `buildAskInsertNode`) is unit-tested directly in
  `reviewDrafts.test.js` ("quotes Compass only when the payload carries one, as a
  G-064 askInsert node (labelled AI)", part of the mutation proof's Q1 target) and
  rendered correctly by the same component the walk drives. Re-running this one check
  in an environment with a working Compass generator would close it to a real PASS;
  nothing in this lane's own code is in question.
* The flag stays dark (unset = OFF) until the wave-13 PR merges and the owner arms it.

## 7. Verification (scoped, by named file)

* `python -m pytest tests/test_leak_finder.py -q` — 18 passed.
* `python -m pytest tests/test_review_drafts.py -q` — 8 passed.
* `python -m pytest tests/test_notebook_flags.py -q` — 18 passed.
* `python -m pytest tests/test_notebook_flag_parse.py -q` — 193 passed.
* `python -m pytest tests/test_leak_finder.py tests/test_review_drafts.py tests/test_notebook_flags.py tests/test_notebook_flag_parse.py -q`
  (run together) — 237 passed in 22.06s.
* `npx vitest run src/pages/journal-2-0/components/insights/InsightsHub.test.jsx src/pages/journal-2-0/lib/reviewDrafts.test.js src/pages/journal-2-0/components/EODRecap.test.jsx src/pages/journal-2-0/components/CompassReview.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.test.jsx`
  — 64 passed (5 files: 17 + 24 + 6 + 5 + 12).
* a11y: `a11y/surfaceCoverage.test.js` — 13 passed (no new population entry needed, see
  §3.3). `a11y/researchCapture.a11y.test.jsx` — 6 passed, 0 axe violations.
* `python tools/check_repo_hygiene.py` — clean.
* Mutation proof: 16 of 16 killed at the lane's true tip,
  `docs/notebook/evidence/wave13-13f/mutation-6c95593ca8de6597acf3b2066015854d1076ff6a.txt`
  (VERDICT: PASS). Superseded runs kept for history:
  `mutation-20577dbd2a-FAIL.txt` (S1/C1 surviving) and `mutation-4a5d530d5e.txt`
  (first clean 16/16, before the touch-target/walk fixes).
* Real-browser walk: flag-ON 7 of 8 checks PASS, 1 INCONCLUSIVE (documented
  environment limitation, §6), `walk-6c95593ca8de6597acf3b2066015854d1076ff6a/`
  (integrity CLEAN). Flag-OFF 4 of 4 PASS, same directory's `walk-off.json`
  (integrity CLEAN). Superseded run kept for history: `walk-999093066f/` (the run
  that found the apostrophe/dollar-format/chevron/probe-scoping bugs, before any of
  them were fixed).
