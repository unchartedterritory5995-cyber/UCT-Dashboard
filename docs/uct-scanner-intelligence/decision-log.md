# UCT Scanner/Pattern Intelligence Program — Decision Log

> Persistent record of the multi-phase scanner intelligence program, per the
> program's own continuity requirement ("must remain recoverable across
> context/session changes"). This file did not exist before Phase 3A —
> Phases 0, 0B, 1, 2, 2B, and 2C were conducted and documented only in
> conversation history, never persisted to disk. That gap predates this
> entry and is **not** retroactively reconstructed here (doing so from
> memory would violate the program's own evidence-discipline rule against
> treating recalled context as authoritative fact). If session continuity
> across those phases matters going forward, treat that as a follow-up.

## Phase 3A — Controlled Production Corrections & Regression Verification
**Date:** 2026-09-02
**Branch:** `phase3a-scanner-corrections` (worktree `uct-dashboard-phase3a`, off `origin/master` @ `b1317f917`)
**Status:** Implementation complete, not merged/deployed — awaiting owner review.

### Lane A — three independently-confirmed detector fixes

1. **Candlestick Bulkowski misquotes** (4 files) — narrative text corrected,
   no behavioral/geometric change:
   - `bullish_engulfing.py`: "~73%" → 63% (rank 84/103)
   - `bearish_engulfing.py`: "~73% mirror" → 79% (rank 91/103); explicitly
     not a mirror of bullish's 63%
   - `evening_star.py`: "~78% mirroring morning star" → 72%; morning star
     really is 78% but evening star's overall rank (4/103) beats morning
     star's (12/103) despite the lower raw reliability number
   - `hanging_man.py`: reframed 59% as the rate the pattern acts as a
     BULLISH continuation (i.e. the bearish thesis is correct <50% of the
     time on raw geometry), not as support for the bearish read
   - Tests: `test_bulkowski_citation_is_accurate` added to all four
     `tests/pattern_engine/detectors/test_*.py` files.

2. **`pullback_to_50sma.py` volume-gate comment/threshold contradiction** —
   comment claimed the reclaim gate enforces ">=1.0x" but the code enforces
   ">=0.9x". Fixed the comment to describe the actual 0.9x threshold and
   removed the unverified "O'Neil institutional return" framing (Phase 2B
   found no primary-source support for a specific reclaim-volume figure).
   Numeric threshold unchanged — zero behavioral change (18/18 fixture tests
   unchanged before/after).
   - **Adjacent finding, not fixed (backlog):** the detector's user-facing
     narrative text (`why_it_matters`, ~line 425) still describes the
     reclaim as "institutional defense"/dynamically inserts the actual
     reclaim-volume ratio next to that framing — at the gate's floor
     (~90%, i.e. *below* average volume) this narrative would read as
     self-contradictory ("volume 90% of average... institutional defense").
     Not touched this phase (narrower defect than authorized; the
     authorized fix was the code-comment contradiction). Recommend a
     follow-up narrative-wording pass.

3. **`power_earnings_gap.py` gap-size calibration** — `_MIN_GAP_PCT` raised
   0.04 → 0.08, sourced to Pradeep Bonde's 2010 Stockbee post ("5+ points OR
   8%+ gain"; percentage branch adopted, dollar-branch not implemented —
   documented limitation, not an oversight). Added `_MAX_GAP_PCT = 1.00` as
   a split/reverse-split-artifact guard (engineering sanity ceiling, not
   sourced to a specific external figure — HYPOTHESIS-tier).
   - Simplified now-unreachable branches in `_score_geometry` (the 4-6% and
     6-8% score bands can never be reached once the gate floor is 8%).
   - Fixture battery regenerated (`tests/fixtures/power_earnings_gap/_generate.py`):
     4 of 5 positive fixtures needed their gap sizes bumped above 8% to
     keep firing (this is expected — those fixtures were built around the
     old, incorrect 4% floor); added 2 new negative fixtures
     (`gap_below_corrected_floor`: 7% gap + 6x volume still correctly
     rejected; `split_artifact_gap`: 150% gap rejected by the new ceiling).
     20/20 tests pass.

### Lane B — VCP Trend Template precondition (the narrow fix, not general tuning)

**Defect:** `detect_vcp` in `vcp.py` evaluated contraction-sequence geometry
with no check on the symbol's longer-term trend structure, so a technically
clean VCP forming while the stock sits below its own 150/200-day SMA (with
the 150 below the 200 — an inverted long-term structure) could fire at high
confidence. Phase 2C's blinded six-case adjudication flagged this
specifically via the KBR case.

**Fix:** added `_passes_trend_template_precondition` — requires price above
both the 150-day and 200-day SMA, with 150-day SMA above 200-day SMA (2 of
Minervini's 8 Trend Template conditions; the 2 computable from a single
symbol's own OHLCV without a cross-sectional RS-rank universe). Fails open
(does not reject) when fewer than 200 bars of history exist to evaluate it.
Deliberately NOT built on `context.py`'s `ma_alignment` field — that field
requires a stricter, different condition (all of last>sma10>sma20>sma50>sma200
stacked; no sma150 at all) and is not a substitute for this specific check.

**Six frozen Phase 2C cases, real production data (`C:\data\bars.db`), before/after:**

| Symbol | Before | After | Notes |
|---|---|---|---|
| IVZ | fires 79.02 | fires 79.02 | unaffected — passes precondition |
| VKTX | not fired | not fired | unaffected — already rejected (also fails precondition, for other reasons) |
| WFG | fires 51.31 | fires 51.31 | unaffected — passes precondition |
| **KBR** | **fires 72.7** | **not fired** | **target fix** — price $37.90 < sma200 $38.52, sma150 $37.31 < sma200 |
| TLX | fires 76.03 | fires 76.03 | unaffected — passes precondition |
| PRKS | fires 66.49 | fires 66.49 | unaffected — passes precondition |

Only KBR changed. Confirmed via a temporary gate-bypass (not a code revert)
that pre-fix behavior exactly reproduces the frozen 72.7 baseline.

**Bounded expanded check:** 60 additional real tickers (random sample,
>=260 daily bars each) run before/after. 3 flips (FUTU, HRTG, BIPC), all
fired→not-fired, all with the precondition failing. Zero anomalies: no
flip occurred while the precondition passed, and nothing fired despite
failing the precondition. The 3 already-firing, precondition-passing cases
(CHI, SYY, BHB) had byte-identical confidence before/after, confirming the
gate is a pure pass/fail precondition with no effect on scoring math.

**New regression fixture:** `tests/fixtures/vcp/below_trend_template.json`
(240 synthetic bars: 170-bar decline dragging the SMAs above a real,
locally-valid VCP contraction sequence) — fires at 85.18 with the gate
bypassed, 0 detections with the fix active. 19/19 VCP fixture tests pass.

### Algorithm versioning
No formal per-detector version field exists in this repo — the only
existing convention is informal "Phase N" references in comments/commit
messages (`diagnostics.py`'s `schema_version: 'phase_0'` is an unrelated,
apparently-unmaintained diagnostics-endpoint field, not a per-detector
version). Per Phase 3A's instruction to use the repo's existing mechanism
rather than invent one, every changed constant/gate is tagged
"Phase 3A, 2026-09-02" in its surrounding comment.

### Full regression
`tests/pattern_engine/` (2264 passed, 9 pre-existing unrelated xfails) +
`tests/test_no_second_authority_across_axes.py` (8 passed) green. Diff
review confirms only the 7 target detector files + their fixtures/tests
changed — no unrelated production behavior touched.
