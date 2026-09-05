# Test Credibility Assessment (P5)

Produced by a dedicated research pass (direct tool execution plus cross-corroborating research forks,
convergence-verified — see "Confidence" below). Read-only; no files written, no mutating git commands run.

## LEAD FINDING — dual-kernel agreement is not vendor parity, and this program has already been burned by exactly this gap once

`tools/ast_conformance.py --check` (run live: `CONFORMANCE LOG MATCHES, 144 asts x 579 bars`) proves the JS
(`interpret.js`) and Python (`ast_interpret.py`) execution kernels agree with **each other** at 1e-9
tolerance. That is real engineering value — and it is a claim about **UCT agreeing with UCT**, not about
UCT agreeing with TradingView, thinkorswim, or TC2000. This is exactly the distinction P5 required be made
explicit, not conflated, and it was not merely asserted but measured directly:

```
$ python tools/vendor_truth.py --check
NO VENDOR OBSERVATIONS ARE HELD -- 0 files in tests/fixtures/vendor/observations/.
This is NOT a pass. It means nothing in this repository has ever compared an
indicator to a number produced outside it, so every green gate here proves
only self-consistency.
EXIT CODE: 2

$ python tools/vendor_truth.py --coverage
stateless  0   NOTHING HELD
seeded     0   NOTHING HELD (the highest-value gap: decays toward agreement,
               invisible in any late window, wrong forever at the left edge)
stateful   0   NOTHING HELD (cannot detect a LATCHING disagreement)
EXIT CODE: 2
```

`tests/fixtures/vendor/observations/` **does not exist as a directory.** Zero UCT indicators, ever, have
been checked against a value actually read off a real TradingView/thinkorswim/TC2000 chart.

A real, well-built middle layer exists: `tools/vendor_spec_probes.py` independently re-implements
TradingView's *published formula text* by hand (forbidden from importing UCT's own `wma`/`rma`), then diffs
it against UCT's real production kernel — run live:

```
✅ ema(close, 10)   worst |Δ| = 0
✅ rma(close, 14)   worst |Δ| = 9.9e-14
✅ sma(close, 20)   worst |Δ| = 4.3e-14
🔴 atr(...)         worst |Δ| = 0.0065, misaligned by exactly 1 bar
                    (known, accepted, deliberately-kept seed-convention
                    difference — decays to 4.4e-12 by bar 299, pinned in
                    tests/fixtures/vendor/divergences.json)
```

This covers **4 of the manifest's 64 functions** (`closedTable.json`: 64 functions, 137 scalars).
`pine.vendorParity.test.js` adds `hma`, but composes UCT's own `wma()` per the documented recipe and diffs
against UCT's own `hma` primitive — not independent of `wma()`; a shared `wma()` bug would pass silently on
both sides (the file's own header: *"That is strong and it is not the same as running both and diffing
them."*). `vendor_spec_probes.py`'s own docstring: *"A SPEC PROBE CAN FALSIFY, IT CANNOT CONFIRM… agreement
CONFIRMS NOTHING."*

**The golden fixtures used everywhere else are circular** — confirmed directly:
`tests/fixtures/indicators/_generate.py:304-305`'s `_write_computed()` sets
`expected = ic.compute_case(kind, bars, params)` where `ic` is `api.services.indicator_compute` — **the
module under test generates its own "expected" values.** (One real exception: a later subset — SAR events,
ATR bands, AVWAP, RS-line — derives from independently-reasoned math or older pinned columns, meaningfully
stronger, though still not vendor-verified.) `tests/fixtures/ast/corpus.json` carries no expected numeric
values at all — a pure structural cross-kernel fixture, not a correctness oracle.

**Net: ~5 of 64 manifest functions have any vendor-referenced check at all.**

### This already happened, in production, once

`tests/test_screener_technicals_accuracy.py`'s own docstring: *"`rsi14` shipped Cutler's RSI under Wilder's
name for the whole universe"* — 525 of 2,748 sampled rows landed on the wrong side of the 70/30 line — *"and
none of the ~9,600 backend tests caught it, because they all assert what the code DOES and the defect was
what the number SAYS."* Caught 2026-08-23 by a dedicated accuracy audit that hand-typed Wilder's and
Cutler's formulas independently, with a control proving the fixture could discriminate the two conventions —
the same methodology `vendor_spec_probes.py` now applies to 4 of 64 translation-layer functions.

**A second, independent incident, found later in this same audit pass**: `tests/test_screener_candles_accuracy.py`
documents that `single_candle`'s range calculation (`rng = max(h-l, 1e-9)`) completed a 0/0 division instead
of refusing on a zero-range bar — *"78 rows on the 2026-08-24 build published `doji` for this."* A
companion control test (`test_the_control_a_real_doji_still_classifies`) confirms the fix doesn't break
genuine doji detection. **This is a second, separate incident, on a different computation, found by a
different accuracy audit** — the screener side is two-for-two on this exact failure shape (a large, green,
self-consistency-only suite missing a real numeric defect), which raises rather than lowers the urgency of
closing the vendor-observation gap on the translation layer, where equivalent scrutiny has never been
applied.

`REQUIREMENTS_LEDGER.md` already flags MP-031 ("Differential Vendor Testing") as "in progress" and MP-032
("Vendor Oracle Protocol") as "not started." This resolves that ambiguity precisely: **the protocol and
harness are fully built, well-designed, self-aware of their own purpose — and hold zero real observations.**
A data-collection gap, not a design gap, and cheap to close (the harness's own README asks for "three
observations, one per shape" as the minimum that turns "we match TradingView" from a hope into a
measurement).

## Q1 — Strong tests vs. implementation-testing-itself

**Real oracles, confirmed by direct reading:**
- `tests/test_screener_technicals_accuracy.py` — hand-typed Wilder/Cutler oracles, never importing
  `indicator_compute`, each with a discriminating control. The file that caught the `rsi14` incident.
- `tools/vendor_spec_probes.py` + `test_our_atr_IS_WILDER_and_the_difference_from_pine_is_the_SEED` — the
  latter independently rebuilds Wilder's ATR by hand inside the test, asserts UCT matches it exactly, and
  asserts two plausible alternative conventions do NOT match.
- `tests/test_signature_*.py` (10 files) — strong for UCT-proprietary compute where "vendor parity" doesn't
  apply: exact hand-computed weighted means, whole-payload exact-dict pins, zero-float-slop boundaries.
- `tests/pattern_engine/detectors/test_group1_narrative_truthfulness.py` /
  `test_group4_geometry_correctness.py` — checked against a real external research corpus
  (`docs/superpowers/research/bases/*.md`), not the detectors' own prior output. **Dated 2026-09-03, one day
  before this audit.** Found: 8 detectors (`bull_flag`, `bullish_engulfing`, `bearish_engulfing`,
  `high_tight_flag`, `flat_base`, `power_earnings_gap`, `episodic_pivot`, `vcp`) shipping fabricated
  statistics and false attributions in member-facing narrative text — an invented "~67% follow-through"
  falsely attributed to Bulkowski (real figure: a 44-45% break-even failure rate), fabricated Peter
  Brandt/Greg Morris/Edwards & Magee citations, a wholly invented "Lance Breitstein"/"Burnt Toast"
  attribution, and a `power_earnings_gap` narrative claiming "4% minimum gap" directly contradicting the
  same file's own `_MIN_GAP_PCT = 0.08` gate constant. `test_group4_geometry_correctness.py` separately
  found `high_tight_flag` stamping both chart anchors to the same timestamp — a degenerate zero-width line
  in the live chart consumer (`TrendlinePair.jsx`). A Group 2 finding (liquidity floor): six detectors had
  zero price/volume gate — reproduced live, a $1.00 penny stock fired `bull_flag` at 92.5% confidence.

**Self-referential (real regression value, not a correctness oracle):** the bulk of `pine.corpus.test.js`,
`thinkscript.corpus.test.js`, `doorScorecard.test.js`, `pine.screenerCorpus.test.js` assert *translates /
evaluates / matches its own recorded snapshot*. Legitimate — would catch the currently-red
`pine.blindCorpus.test.js` regression — but answers "did the verdict change," not "is it correct."

`test_confidence_formula_engine_wide.py` and `test_lift_ledger.py` (causal walk, no look-ahead, "a
look-ahead here would not fail loudly — it would quietly produce a spectacular lift") are methodologically
serious meta-tests.

## Q2 — Mocked boundaries

No instance found, across either translation-layer or screener scope, of a test mocking away the thing it
claims to verify. Consistent pattern: **isolate storage location, exercise real logic** (DB-path
`monkeypatch` to a temp file, real SQL against a real fresh schema). Narrow, reasonable external mocks only:
one live ~20s Schwab options-chain call, one outbound alert-delivery transport (docstring explains why).
`test_repaint_is_the_verdict_AT_SAVE_TIME` is a **good** use of mocking: monkeypatches the linter to prove
the persisted repaint badge isn't silently re-derived on read, with a control proving the patch took effect.

## Q3 — Missing coverage, quantified

| Item | Coverage found | Verdict |
|---|---|---|
| Numeric-vs-boolean screener gate | Both directions, fail-closed on classifier exception, correct blame attribution | **Covered** |
| "Honest-None" disclosure | Real temp DB, exact-membership assertions | **Covered** |
| Save idempotency / double-submit (RISK-012, browser-found) | Zero hits across 84 tests for this failure mode; the one idempotency test proves sequential same-process dedup, a different failure mode entirely | **Not covered** — a real gap between what browser testing found broken and what the backend suite guards |
| RISK-013 (Pine `input()` fidelity) | No test found | **Not covered**, same pattern |
| Populated screener scan, hand-verified exact membership at real-market scale | Mechanism-level tests strong, only against small synthetic fixtures | **Not found** in ~15-20 of 85 files sampled directly; partial confidence, ~65-70 files unopened |

`test_screener_absent_column_refusal.py`: first-rate negative-path work — found and fixed a SQLite
double-quoted-identifier bug where a missing/misspelled column silently degrades to a **string literal**, so
`>=`/`>`/`!=` filters (the majority of real screener filters) would silently match the **entire universe**
while `<=`/`<`/`=` silently return empty — a textbook false-success defect, fixed across all 5 call sites,
regression-tested.

## Q4 — Skipped/disabled/flaky

- JS translation layer: zero real skips; grep matches are comments documenting the deliberate *absence* of
  a skip guard.
- `test_ast_conformance.py`: 5 skips, all conditional on an earlier build-phase now permanently true
  (confirmed dormant live: 67 passed, 5 skipped).
- `test_confidence_formula_engine_wide.py`: 9 `xfail(strict=True)`, each individually reasoned per detector
  — `strict=True` means an accidental fix flips this to a hard failure, not a silent pass.
- Screener: one flag-gated skip (working as intended); `test_screener_integration.py` skips 2 tests when
  local market bars aren't available — contributed zero verification in the live run; worth confirming CI
  has real local bars rather than silently skipping there too.
- Overall: unusually disciplined skip/xfail hygiene — every instance carries a specific, checkable reason.

## Q5 — Weak assertions

Targeted greps for vacuous patterns returned **zero matches** in the translation-layer scope. In
screener/pattern-engine, `assert X is not None` appears ~20 times across 85 files; every instance checked
in context was a precondition guard before a stronger assertion, not the entire claim (medium confidence,
not every instance checked). Dominant pattern instead: **pairing every test that could pass vacuously with
an explicit control that proves it can't** (`vendor_truth`'s count-and-shape reporting,
`vendor_spec_probes.py`'s `control()`, pattern-engine's `assert pos, f"{pattern_id}: no positive fixtures
found — test would be vacuous"`).

**The more important finding sits one level up: weak assertions are not this suite's dominant risk —
missing dimensions are.** The Group 1-4 fixes are the clearest illustration: a large, rigorous,
control-guarded battery (152+ fixtures across 8 families) stayed green throughout while narrative text was
fabricated, liquidity floors were absent, event semantics drifted, and chart geometry degenerated — because
none of those tests had ever asserted anything about those specific axes. Mirrors the `rsi14` incident
exactly: a green, well-built suite proving internal consistency while a real defect ships underneath it,
undetected because nobody had asked that particular question yet.

## Synthesis

1. The lead finding is real, live-verified, not hypothetical — the predicted failure mode already happened
   twice in production on the screener side, independently.
2. This suite's craftsmanship is genuinely high where it has assertions at all — not, on the whole, a suite
   full of weak assertions.
3. The dominant real risk is missing dimensions, not weak checks on existing dimensions.
4. A specific, confirmed regression gap exists between browser-found bugs (RISK-012/013) and backend
   coverage — the standard bug workflow's regression-test step is missing for both.
5. Both the vendor-parity gap and the pattern-engine narrative-fabrication findings share one root cause:
   heavy investment in proving *internal* consistency, comparatively little in checking against ground
   truth genuinely external to the codebase.

## Unknowns

- Full extent of the narrative-fabrication/liquidity-floor/event-semantics/geometry risk across the ~90 of
  ~100 registered pattern-engine detectors *not* covered by the Group 1-4 sweep (8 checked so far).
- Whether a populated, real-market-scale screener scan with hand-verified exact symbol membership exists
  anywhere in the ~65-70 of 85 `test_screener_*.py` files not directly opened.
- Whether CI actually provides real local market bars for `test_screener_integration.py`, or silently and
  permanently skips its 2 tests.
- Whether TC2000/PCF's self-authored 57/57 corpus has a Group-1-4-equivalent hidden-dimension risk (flagged
  open in `BENCHMARK_REPRODUCTION.md`; RISK-009; not independently investigated here).

## Recommendations

1. State the self-agreement-vs-vendor-parity distinction explicitly, in writing, inside
   `BENCHMARK_REPRODUCTION.md` and `CURRENT_ARCHITECTURE.md` themselves — both are rigorous but never say
   outright "none of these numbers are vendor-parity evidence."
2. Populate `tests/fixtures/vendor/observations/` with the harness's own specified minimum ("three
   observations, one per shape") — the single highest-leverage item this audit found; data entry against
   existing, already-tested infrastructure, not new engineering.
3. Add regression tests for RISK-012 and RISK-013 — root cause already understood from CGJ#1; only the
   regression-coverage step is missing.
4. Extend the Group 1-4 sweep method from 8 detectors to the remaining ~90+ — it found four real defects in
   one day; no evidence the untouched detectors are cleaner.

## Tests run (all live, read-only)

`python tools/vendor_truth.py --check` → exit 2, 0 observations (2 independent runs, matching) ·
`--coverage` → exit 2, all 3 shapes at 0 · `vendor_spec_probes.py` → 4 probes, 3 agree, 1 known divergence ·
`ast_conformance.py --check` → 144 ASTs × 579 bars match · `--coverage` → fails on `base_relation_count` ·
`vitest run .../ast/` → 108/109 files, 2054/2055 tests (1 known-red, matches `BENCHMARK_REPRODUCTION.md`) ·
`pytest` signature+user_definitions → 398-413 passed (two runs, 0 failures either way) ·
`test_ast_conformance.py test_ast_indicators.py` → 67 passed, 5 skipped (phase-superseded) · pattern_engine
+ base_count → 2632-337 passed depending on scope, 9 xfailed both times (0 unexplained failures) ·
`test_screener_*.py` → 1336 passed, 2 reasoned skips.

## Confidence

Lead finding: **Very high** — live tool execution, independently reproduced twice with matching results,
corroborated by two separate real production incidents matching the predicted failure mode exactly.
Translation layer (Q1, Q3-Q6): **High** — large direct samples plus full-suite runs matching
`BENCHMARK_REPRODUCTION.md` exactly. Screener/pattern-engine (Q1, Q3-Q6): **High-medium** — strong,
mutually-consistent sampling across independent passes, but not all 85+143 files read individually; "not
found" claims in the unsampled remainder mean "not found in what was checked," not a clean bill of health.
