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

## Phase 3C — System-D VCP Trend Template Correction

**Date:** 2026-09-03. **Merged:** `f38363d53` (base_catalog.py) →
`bc8c891a6`. Evidence: `docs/uct-scanner-intelligence/vcp_gold_standard/data/
{phase3c_predicted_flips,phase3c_revalidation}.json`.

⚠️ Note: this program's Phase 3B (VCP 82-case gold-standard study, Lane A;
historical-score data-prerequisite fix, Lane B) is ALSO absent from this log
and is not backfilled here — that is a separate, pre-existing gap, out of
scope for this narrow correction (its evidence lives in
`docs/uct-scanner-intelligence/vcp_gold_standard/data/{case_answer_key,
adjudication,metrics}.json`, committed at `96ff06df4`/`69c9e7fff`).

**Defect:** `vcp_state` in `base_catalog.py` (System D) had the identical gap
System A's Phase-3A fix addressed — no check on price's position relative to
its own 150/200-day SMA, only a point-to-point prior-advance check that a
sharp rally inside an overall downtrend could still satisfy. Confirmed via
the frozen 82-case gold-standard set: 11 of System D's 14 reviewer-confirmed
unique false positives (78.6%) had `trend_template_150_200=False` in the
blinded evidence; its 2 true positives both already had it `True`.

**Fix:** `_passes_vcp_trend_template_precondition` — the identical two-of-
eight Minervini conditions as System A's Phase-3A fix (price above both
150-/200-day SMA, 150 above 200), fails open under 200 bars, sourced to the
same `_MINERVINI` Criterion id already used by VCP's other 15 criteria (2 new
Criterion entries added, verbatim `[TTLAC]` quotes).

**11 pre-registered cases (frozen before implementation), real production
data:** EXEL, CGON, DTM, BBWI, BAM, WMB, PWP, OSCR, EQT, BNTX, KARO — all
predicted to flip fired→refused. **Actual: 11/11 flipped exactly as
predicted.** 3 watchlist cases (ADEA, OMF, FTDR — `trend_template=True`, not
explained by this fix) and 2 true positives (BOKF, VTRS) predicted NOT to
move — **0/5 moved.**

**Full 82-case metrics (n=48 scored, 34 borderline excluded):**

| | Before | After |
|---|---|---|
| Precision | 11.1% | 28.6% |
| Recall | 25.0% | 25.0% (unchanged) |
| F1 | 0.154 | 0.267 |
| FP | 16 | 5 |

Zero new false negatives on any reviewer-consensus-positive case. 2
additional D-only fires removed on cases with no reviewer consensus (EVC,
LINC — `agreement_level` BORDERLINE-majority/unresolved), never scored as
true positives either side.

**Second proposed fix status:** unchanged, INSUFFICIENT EVIDENCE/WATCHLIST —
no new evidence surfaced this phase.

**System A:** zero diff — confirmed frozen throughout.

**Regression:** 2451 passed / 1 pre-existing unrelated failure (verified via
git-stash before/after to predate Phase 3C, a Phase-3A-vs-cross-engine-
measurement staleness, unrelated) / 2 skipped (environment) / 13 errors
(Node.js not on PATH, environment, unrelated) across the 126-file
base_catalog/bases-dependent suite.

**Phase 3D (2026-09-03, same day):** refreshed the stale cross-engine
agreement measurement (`tools/two_engine_agreement.py`, prior run
2026-09-01) against both engines' post-fix state. VCP row: `engine_only`
144→89 (System A, Phase 3A), `base_only` 23→21 (System D, this phase),
kappa 0.003→0.025 (still near-independent). Canonical-direction decision
**closed**: semantic split (System D = screener WHETHER surface, System A =
Compass WHERE-to-enter surface) reaffirmed, not reopened — evidence:
`docs/uct-scanner-intelligence/vcp_gold_standard/data/
phase3d_two_engine_agreement_2026-09-03.{json,txt}` (uncommitted to master;
committed on branch `phase3d-vcp-canonical-decision` @ `751c1cdd6`, not yet
merged).

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

## Phase 6, Group 3 — episodic_pivot gap-identity threshold: owner decision 8% → 4%
**Date:** 2026-09-04
**Branch:** `phase6-package-b-group3` (Package B, isolated, unmerged — requires its own owner-review gate per Phase 6's authorization)

### Background
Phase 6 Group 3 (2026-09-03) added a real gap-identity gate to `episodic_pivot.py`
(previously the detector extracted `ep_open` but never used it — see that
section of this log / the Phase-6 report for the full defect). The gate was
implemented at `_MIN_GAP_PCT = 0.08`, sourced to Bonde's 2010 Stockbee post.
Phase-6 revalidation (closure report, 2026-09-03) found this number was not
the only one Bonde himself published: his own 2014 process-flow post gives
4% (`c/c1 > 1.04`). Of the 23 cases the 8% gate removed from a full-universe
pre-registration scan, 5 (BRBS 4.3%, EDIT 4.5%, WPM 5.2%, RXRX 6.0%,
NVAX 6.3%) sat specifically in the 4%-8% band — clearing Bonde's looser,
later number but not his stricter, earlier one. This was flagged as a
genuine sourced ambiguity, not a code defect, and escalated for an owner
decision rather than resolved unilaterally.

### Competing definitions
| Source | Threshold | Note |
|---|---|---|
| Bonde, 2010 Stockbee post ("What are Episodic Pivots and how to find them") | 8%+ (or $5+/pt, OR'd) | His original published EP scan |
| Bonde, 2014 process-flow post | 4%+ (`c/c1 > 1.04`) | Same author, same named setup, later revision — not a second coexisting tier |
| Kullamägi (Qullamaggie) | 10%+ | Independent, explicitly-derivative variant; not part of this specific choice between Bonde's two numbers |

No source in the corpus frames 4% vs. 8% as an identity/quality split (a
looser floor for "still an EP but lower quality") — the honest read is that
Bonde revised his own operational definition over time.

### Evidence: blinded owner adjudication
Five real live cases (the 4-8% band) were presented to the owner as a
blinded chart-pattern review (ticker, dates, and structural facts shown;
threshold values, engine output, and source recommendation withheld) via
an artifact (`docs/uct-scanner-intelligence/tier1_validation/
blinded_ep_review.html`). The owner was unable to independently verify
chart-pattern identity from the material shown and explicitly directed
recording `Identity: YES` for all five as a non-independent placeholder
rather than a genuine chart read. Because a uniform answer cannot
discriminate between the 4% and 8% interpretations (every case in the band
would get the same label regardless of which specific case was shown),
this was **not** treated as evidentiary for the threshold choice — see the
Phase-6 Revalidation Closure Report and the Package-A-merge/Package-B-
adjudication report for the full transcript of that reasoning, disclosed
transparently to the owner at the time.

### Owner decision
**Move `_MIN_GAP_PCT` from 0.08 to 0.04.** Basis: Bonde is the detector's
own cited origin; his 2014 figure is his own later revision of his 2010
figure; keeping the superseded number over his self-updated one needed a
justification that was never found. Decision made and approved by the
owner 2026-09-04, independent of the placeholder blind-adjudication input
above.

### Implementation
`api/services/pattern_engine/detectors/uct/episodic_pivot.py`:
`_MIN_GAP_PCT = 0.08` → `0.04`, docstring/geometric-definition comments
updated to match. Two new fixtures added to the test-first battery
(`tests/fixtures/episodic_pivot/boundary_band_5pct_gap.json` — a 5% gap
case that must now fire, confirmed to FAIL under the pre-change 8% floor
before the fix, per test-first discipline; `below_4pct_gap_still_refused.json`
— a 3% gap case that must stay refused under either interpretation, as a
control). No other file touched — `power_earnings_gap.py` and `context.py`
diffed at zero lines against the prior Package-B commit.

### Revalidation
- All 5 target cases (BRBS/EDIT/WPM/RXRX/NVAX) confirmed REFUSED pre-change,
  SURVIVES post-change, matching the owner decision. This is the strong,
  deterministic evidence for the change — synthetic-fixture inputs, exact
  and reproducible.
- Deterministic fixture battery (test-first): `boundary_band_5pct_gap.json`
  (5% case, confirmed to FAIL under the pre-change 8% floor before the fix)
  and `below_4pct_gap_still_refused.json` (3% control, refused under either
  interpretation) both pass as specified. A precise, hand-built boundary
  test (`test_gap_gate_boundary_is_inclusive_at_exactly_4_percent` +
  neighbors, exact round-number prices, no fixture-generator rounding
  noise) confirms the gate's `<` comparison is inclusive at exactly 4.00%
  — added after independent review flagged that "clearly above" (5%) and
  "clearly below" (3%) cases alone don't pin the exact operator semantics.
- Full-universe rescan (3693 symbols, same universe as the original
  pre-registration): firing count 3→7 (was 26 pre-Group-3-gap-gate, 3 under
  8%, 7 under 4%), with no firing outside the already-characterized 26-case
  set. **Caveat, not a controlled experiment:** `C:\data\bars.db` is a
  live, continuously-updated mirror, and it advanced between the original
  pre-registration scan and this revalidation (both run within the same
  long session) — so this is a live-data sanity check corroborating the
  deterministic evidence above, not a frozen, strictly-controlled
  before/after comparison. The deterministic fixtures are what actually
  establish the threshold's correctness; the rescan shows no unexpected
  live-universe consequence, no more and no less.
- One expected case (EL, one of the original 3 survivors under 8%) no
  longer fires in the rescan — confirmed benign: its EP bar aged past the
  detector's 5-bar recency window because bars.db advanced ~11 trading days
  between the two scans. Its underlying gap_pct (11.24%) is unchanged and
  still valid; only its "recent" status expired, which is the detector's
  intended behavior for a live-scan freshness gate, not a threshold defect
  — this is exactly the kind of data-currency artifact the caveat above
  exists to name.
- Evidence: `docs/uct-scanner-intelligence/tier1_validation/data/
  phase6_group3_owner_4pct_revalidation_2026-09-04.json`.

### Full regression
`tests/pattern_engine/` (2355 passed, 9 pre-existing unrelated xfails) +
Compass/scheduler consumer set (64 passed) green. `power_earnings_gap.py`
and `context.py` confirmed untouched (zero diff).

### Reversibility
Single-constant change (`_MIN_GAP_PCT`), fully reversible by reverting one
line; no schema, migration, or irreversible state change involved. Not yet
merged — remains on `phase6-package-b-group3`, pending the Package-B
owner-review gate covering the whole Group-3 correction (gap gate +
earnings-linkage disclosure), not just this threshold sub-decision.
