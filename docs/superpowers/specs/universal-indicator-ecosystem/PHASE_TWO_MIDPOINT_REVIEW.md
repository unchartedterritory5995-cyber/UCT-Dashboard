# Phase Two Midpoint Review — Lane A Complete

Produced per explicit owner authorization following the ADX-family batch's acceptance: "PHASE TWO
MIDPOINT CHECKPOINT — LANE A COMPLETE... Produce a formal PHASE_TWO_MIDPOINT_REVIEW.md. This is an
evidence-synthesis and prioritization checkpoint, not another implementation tranche."

**Methodology note**: every figure below was reconstructed directly from committed artifacts —
`tests/fixtures/vendor/observations/*.json`, `tests/fixtures/vendor/parity/*.json`,
`tests/fixtures/vendor/divergences.json`, `pytest --collect-only` test counts, and the full text of
every cited report/risk-register row — not from conversational summary. Two corrections surfaced
during this reconstruction and are stated plainly rather than silently folded in: (1) the true
structural warmup for a `kPeriod`-window function is `kPeriod - 1`, not `kPeriod` (already corrected
in the Stoch/ADX reports themselves, restated here for completeness); (2) **the framing "bands/fill/
colorMode were not live-render-verified because of the visual harness/rendering blocker" is
INCORRECT** — RISK-027 (an unrelated font-timing flake in the pixel-parity harness, on one unrelated
SMA fixture) and RISK-029 (the real bands/fill/colorMode/composite-arithmetic finding, proven via
document/schema validation, not blocked by any harness) are two independent findings that happen to
share one reused fixture name. See §6.

No product code was changed by this review. No new implementation was begun.

---

## 1. Vendor Parity Coverage Matrix

Every function/output with real TradingView vendor evidence, as of this checkpoint.

| Function/Output | UCT impl | Total bars | True structural warmup | Convergence boundary | Warmup used | Steady-state compared | Max abs Δ | Max rel Δ | Qualified status |
|---|---|---|---|---|---|---|---|---|---|
| `rising` | closed-table `rising` | 300 | not separately stated | n/a (audit-level) | 4 | 297/300 | 0 | not stated | **VENDOR-PARITY VERIFIED — MULTI-BAR** |
| `median` (even-len) | closed-table `median` | 300 | not stated | n/a | 4 | 297/300 | 0 | not stated | **VENDOR-PARITY VERIFIED — MULTI-BAR** |
| `percentrank` | closed-table `percentrank` | 300 | not stated | n/a | 4 | 291/300 | 0 | not stated | **VENDOR-PARITY VERIFIED — MULTI-BAR** |
| `bbw` | closed-table `bbw` | 300 | not stated | n/a | 20 | 281/300 | 0 | 9.4e-16 | **VENDOR-PARITY VERIFIED — SCOPED CONTRACT** (integer multiplier) |
| `rsi(close,14)` | `compute_rsi_raw` | 1,328 | 14 | idx 172 | 180 | 1,148 | 7.19e-06 | ~1e-9 | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR** |
| `atr(h,l,c,14)` | `compute_atr_raw` | 1,328 | 14 | idx 169 | 180 | 1,148 | 3.85e-06 | ~1e-9 | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR + PARTIAL/UNVERIFIED INITIALIZATION BOUNDARY** |
| `sma(close,20)` | `_window_mean` | 2,031 | 19 | none (memoryless) | 19 | 2,012 | 1.48e-12 | noise | **VENDOR-PARITY VERIFIED — MULTI-BAR** |
| `ema(close,20)` | `_ema_col` | 2,031 | 19 | idx ~100 | 100 | 1,931 | 1.22e-04 | ~1e-7 | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR + INITIALIZATION CANDIDATE-VERIFIED** |
| `rma(close,14)` | `_rma_col` | 2,031 | 13 | idx 130 | 150 | 1,881 | 6.40e-05 | ~2e-7 | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR + INITIALIZATION CANDIDATE-VERIFIED** |
| `wma(close,20)` | `_window_weighted_mean` | 2,031 | 19 | none (memoryless) | 19 | 2,012 | 0.0 (exact) | 0.0 | **VENDOR-PARITY VERIFIED — MULTI-BAR** |
| `hma(close,20)` | composed of `wma` only | 2,031 | 22 | none (memoryless) | 22 | 2,009 | 0.0 (exact) | 0.0 | **VENDOR-PARITY VERIFIED — MULTI-BAR** |
| `macd` line (12,26) | `_ema_core` (internal) | 2,031 | 25 | idx 191 | 210 | 1,821 | 4.60e-08 | not stated | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR** |
| `macd` signal | `_ema_col` (composed) | 2,031 | 33 | idx 197 | 210 | 1,821 | 6.77e-08 | not stated | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR** |
| `macd` histogram | composed subtraction | 2,031 | 33 | idx 183 | 210 | 1,821 | 2.17e-08 | not stated | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR** |
| `stoch(h,l,c,14)` %K | `compute_stoch_raw` | 300 | 13 | none (memoryless) | 13 | 287 | 1.42e-14 | not stated | **VENDOR-PARITY VERIFIED — MULTI-BAR + PARTIAL/ZERO-RANGE BEHAVIOR UNVERIFIED** |
| `plusDI(h,l,c,14)` | `compute_adx_raw`[1] | 300 | 14 | idx 150 | 170 | 130 | 2.78e-06 | not stated | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR** |
| `minusDI(h,l,c,14)` | `compute_adx_raw`[2] | 300 | 14 | idx 153 | 170 | 130 | 8.53e-06 | not stated | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR** |
| `adx(h,l,c,14)` | `compute_adx_raw`[0] | 300 | 27 | idx 204 | 220 | 80 | 9.18e-06 | not stated | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR + PARTIAL/ZERO-DENOMINATOR UNVERIFIED** |
| `DX` (standalone) | not independently exposed by the closed table | — | — | — | — | — | — | — | **NOT independently claimed as a user-facing parity surface** — exercised only indirectly via ADX + the DX-specific isolation mutations |

**`divergences.json` — 6 rows, all statuses**: `atr-tr-starts-at-bar-1` (accepted), `smoother-seeds-
with-sma-of-first-window` (refuted), `nan-restarts-the-smoother` (suspected), `mod-takes-the-sign-
of-the-dividend` (suspected), `hull-half-window-floors` (confirmed), `recursive-smoother-cold-start-
in-a-finite-capture` (confirmed — cited via `expect.explains` by rsi/atr/ema/rma/macd-line/macd-
signal/macd-histogram, 7 observations).

**Permanent regression test counts** (exact, via `pytest --collect-only`): `test_vendor_parity_
rsi_atr.py`=14, `sma_ema.py`=17, `rma_wma.py`=18, `hma_macd.py`=33, `stoch.py`=13, `adx.py`=25,
`lane_b.py`=12, `lane_b_multibar.py`=6. **Total: 138 vendor-parity tests.**

**Manifest coverage**: 12 unique closed-table entries now real-vendor-comparable (`rsi`, `atr`,
`sma`, `ema`, `rma`, `wma`, `hma`, `macd`, `stoch`, `plusDI`, `minusDI`, `adx` — `macd`'s signal/
histogram are compositions, not separate manifest entries) plus 4 more from the earlier Lane B pass
(`rising`, `percentrank`, `median`, `bbw`) = **16 of 64 manifest functions** with real vendor
comparison, up from 0 at the start of this program.

**Known documentation asymmetry, disclosed rather than smoothed over**: rsi/atr/sma/ema/rma/wma/hma/
macd's own reports do not each individually cite a `tools/ast_conformance.py` dual-kernel result the
way the Stoch and ADX reports do — this reads as a real methodology gap that widened over time (later
batches added the explicit step), not a hidden defect. All 12 closed-table entries above ARE present
in the frozen 144-AST conformance corpus and none is among the 4 currently-known, already-classified
RISK-033 mismatches (`rising_close_3`/`median_close_4`/`percentrank_close_10`/`bbw_close_20_2`) — this
was independently re-verified for this review — but the earlier reports simply don't say so in
writing.

## 2. Parity Status Counts

| Status class | Count | Functions/outputs |
|---|---|---|
| VENDOR-PARITY VERIFIED — MULTI-BAR (zero seed-lag / memoryless) | 7 | rising, median, percentrank, sma, wma, hma, stoch %K |
| VENDOR-PARITY VERIFIED — SCOPED CONTRACT | 1 | bbw |
| VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR (no extra qualifier) | 6 | rsi, macd line, macd signal, macd histogram, +DI, -DI |
| VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR + INITIALIZATION CANDIDATE-VERIFIED | 2 | ema, rma |
| VENDOR-PARITY VERIFIED + PARTIAL/[boundary] UNVERIFIED | 3 | atr (init boundary), stoch (zero-range), adx (zero-denominator) |
| Vendor-semantics-only / not independently claimed | 1 | DX |
| Unsupported / correctly refused (translator-level, not vendor-tested) | — | asymmetric `ta.dmi(diLen,adxLen)` — see §1's ADX row |

**18 of 19 rows are fully, independently VENDOR-PARITY VERIFIED user-facing surfaces.** None are
collapsed into one inflated label — every qualifier (steady-state vs multi-bar, initialization-
candidate vs unqualified, and every disclosed PARTIAL boundary) is preserved exactly as each batch's
own report stated it. JS/Python dual-kernel agreement is counted nowhere in this table as vendor
evidence (kept structurally separate per every batch's own explicit convention); synthetic fixtures
(stoch's zero-range control, this review found no others) are excluded from vendor-evidence counts by
construction and are labeled as internal-consistency-only wherever they appear.

## 3. Unverified Semantic Boundaries — Risk-Classified

| Boundary | Where documented | Classification | Rationale |
|---|---|---|---|
| ADX zero-denominator (`+DI+-DI==0`) | RISK-040, ADX report §11 | **LOW** | Never occurs in real market data across any capture this program has taken (0/287 in the ADX capture, 0/287 in Stoch's zero-range check); a synthetic-only, honestly-labeled control exists for internal consistency. Real-script likelihood: near-zero for any liquid instrument. |
| Stoch zero-range (`highestHigh==lowestLow`) | RISK-039, Stoch report §10 | **LOW** | Same reasoning — 0/287 real windows. |
| ATR true initialization origin (`atr-tr-starts-at-bar-1` alignment claim) | RISK-031, divergences.json | **LOW-MEDIUM** | Steady-state agreement is CONFIRMED by real vendor data; only the deep-historical alignment claim (pre-dating this capture's own start, decades before) remains untested — and cannot be tested without a capture reaching SPY's actual 1993 inception, which is not practically obtainable. |
| EMA/RMA true initialization origin | RISK-034/RISK-035, VALIDATION_COVERAGE_MAP.md | **MEDIUM** | The steady-state check alone is CONFIRMED unable to discriminate a wrong seeding convention (a wrong-seed mutation still passes at 0 disagreements) — this is a real, demonstrated limit of what a steady-state-only check can prove. The SEPARATE early-bar candidate-discrimination check closes it to "candidate-verified" (81/81, 137/137 real early bars favor the true convention) but this is deliberately NOT the same as an unqualified claim, per explicit standing instruction. |
| Asymmetric `ta.dmi(diLen,adxLen)` | RISK-040, ADX report §1 | **LOW** | Correctly REFUSED (`pine:tuple`) rather than silently collapsed — this is a scoped product limitation with a correct, tested refusal behavior, not a silent-wrong-answer risk at all. |
| `rising`'s NA-skip convention | VALIDATION_COVERAGE_MAP.md, Lane B row | **MEDIUM** | The closed table's own uniformly-applied NA-anywhere-in-window rule is pre-existing and not unique to `rising`, but the real capture artifact contains ZERO NA-gap rows, so Pine's real na-skip behavior is genuinely untested. Real scripts with gap data (holidays, halts, newly-listed symbols) could exercise this. |
| `bbw`'s `mult:int` (non-integer multiplier) | VALIDATION_COVERAGE_MAP.md, Lane B row | **LOW** | Confirmed a translator/input-surface limitation only — the compute formula itself is verified float-capable by direct code read. A pre-existing, whole-grammar constraint (no function anywhere has a float-literal type today), not a new or isolated narrowing. |
| `median`'s odd-length branch | VALIDATION_COVERAGE_MAP.md, Lane B row | **LOW** | Never exercised by the real artifact (every row used n=4) — a disclosed coverage gap, but no known ambiguity exists for odd-length medians the way there was for even-length ones (which prompted this whole capture). |
| Pattern-engine narrative fabrication (~90 of ~100 detectors unswept) | RISK-021 | **HIGH** | See §7 — this is NOT a vendor-parity boundary but is the single highest silent-wrong-answer risk density found anywhere in this program's evidence base, and belongs in this classification exercise on that basis. 4 real defects found in 8 detectors checked (50% hit rate); explicitly "no evidence the untouched detectors are cleaner." |

**Not automatically recommending remediation of any of these** — per instruction, this is
classification, not a fix list. The pattern-engine finding is the one item here whose risk profile
argues for near-term action independent of this review's own scope (see §9/§13).

## 4. Public-Script Compatibility State (8-script corpus)

Authoritative source: `TRACK_F_V1_1_INPUT_BOOL_COMPLETION_REPORT.md` §9 (the most recent full re-run).

| # | Script | Deepest stage | Classification | Clean? | Remaining blocker | Blocker type |
|---|---|---|---|---|---|---|
| 1 | Chandelier Exit | saved-and-working | fully supported | **10/10** | — | n/a |
| 2 | QQE MOD | real-import-readback | partially supported | **3/6** | lagged self-reference inside a `min`/`max` arm, refused by the convergence-soundness gate by design | **execution-model** |
| 3 | CM Williams Vix Fix | saved-and-working | fully supported | **4/4** | — (fixed, Tranche 1) | n/a |
| 4 | Daily/Weekly/Monthly H/L | parse/translate | correctly refused | **0/6** | array/collection usage (`pine:collection`) | **correct-refusal** (closed-table gap, honestly refused, not a silent wrong answer) |
| 5 | ZigZag++ | parse/translate | correctly refused | **0/8** | top-level external-library import (`pine:module`) | **correct-refusal** (real vendor resolves it fine; UCT's own architecture doesn't support external module imports — RISK-030) |
| 6 | Support Resistance Channels | real-import-readback | fully supported (offered set) | **6/6 offered** | 2 OTHER identifiers (`resistancebroken`/`supportbroken`), outside the offered set, refuse `pine:reassign` | **translator** (expression-folding/reassignment limitation, separate from the fixed boolean gate) |
| 7 | Minervini Trend Template | real-import-readback | fully supported | **2/2** | — (fixed, Track F v1.1) | n/a |
| 8 | Pocket Pivot Breakout | saved-and-working | fully supported | **3/3** | — (fixed, Tranche 1) | n/a |

**What changed, and by which fix**:
- Tranche 1's `downstreamScopeFor` scope-merge fixed **CM Williams Vix Fix** (`3/4→4/4`) and
  **Pocket Pivot Breakout** (`≤1/3→3/3`) — both bare, untyped `input()` readback.
- Track F v1.1's `input.bool` promotion fixed **Support Resistance Channels** (`4/6→6/6 offered`) and
  **Minervini Trend Template** (`0/2→2/2`) — both typed `input.bool` readback.
- **QQE MOD, Daily/Weekly/Monthly H/L, and ZigZag++ are unchanged**, per explicit standing
  instruction each time — none reinterpreted as a failure merely for remaining unsupported; two of
  the three are CORRECT REFUSALS (honest, not silent-wrong), and QQE's is a soundness-proof boundary
  deliberately not reopened without dual ownership.

## 5. Track F Current State

**`TRACK F CLOSED FOR NARROW v1.1: input.int, input.float, input.bool.` RISK-013 remains PARTIALLY
CLOSED.**

Every other Pine input category remains open: `input.string`, `input.source`, `input.timeframe`,
`input.symbol`, `input.time`, `input.color`, switch/branch-driving inputs beyond a plain boolean,
numeric `options` enums, bar-displacement inputs.

**Real-corpus demand check, done honestly rather than assumed**: `27-support-resistance-channels.
pine` uses an `input.string(..., options=[...])` enum-style input, and `14-earnings-gap-ups.pine`
uses enum/UDT/`method`/`switch` constructs — both confirmed resolving live in the real vendor. **But
in BOTH cases, the current UCT blocker for the affected identifiers is a DIFFERENT, unrelated guard**
(`pine:reassign` for SRC's `resistancebroken`/`supportbroken`; `pine:no-output`, a confirmed-correct
pre-existing refusal, for the Earnings Gap Ups script) — **implementing either input category would
not by itself unblock either script.** No demand evidence was found for `input.source`/`input.
timeframe`/`input.symbol`/`input.time`/`input.color`/bar-displacement in any script tested so far
(a disclosed coverage gap, not a claim of zero demand across the whole corpus).

**Conclusion: do not prioritize another Track F input type on the strength of current evidence** —
the two scripts that would most obviously benefit from enum-style inputs are blocked by something
else entirely.

The previously-deferred Formula-tab window-argument pre-check (message parity with Pine import) is
**confirmed SHIPPED**, not pending — `formulaTabWindowRefusal`, landed in the same reconciliation
session that closed Track F v1.1's review.

## 6. Compatibility / Visual Harness State — WITH A CORRECTION

**A framing error in this review's own originating instructions is corrected here rather than
silently repeated.** RISK-027 and RISK-029 are two INDEPENDENT findings that happen to share one
reused fixture name (`ast_user_formula_sma20`) — no document in this repository states that RISK-027
is the reason bands/fill/colorMode were not visually confirmed.

**RISK-027** (Layer B, Level 1, pixel-parity re-run): a reproducible `FontNotSettledError` on ONE
plain-SMA-20 fixture in this session's own dev environment — the obvious hypothesis (unserved font
route) was tested and DISPROVEN (`curl` to the exact font URL returned `200 OK` directly). Root cause
UNDIAGNOSED, logged and not investigated further per that tranche's explicit scope. It says nothing
about bands, fill, or colorMode.

**RISK-029** (Lane 2, Levels 1-6, document/schema validation — NOT live browser rendering): building
and validating REAL documents (not asserted from reading the schema alone) found that `defSchema.js`/
`nativeRegistry.js`'s `validateUserDefinitions` supports materially more visual capability than
`BuilderSheet.jsx`'s own authoring UI exposes:
- **Bands** (`style:'band'`, `edges:{upper,lower}`) install cleanly on a user `ast`-kind document —
  the UI simply has no control for it. **A product-exposure gap, not a rendering-blocked gap.**
- **`plots[].fill:{with}`** is schema-valid and persists correctly but is **confirmed drawn by
  nothing** — a pre-existing, deliberate VALIDATED-BUT-INERT state, unrelated to any harness.
- **`colorMode:'sign'`/`'column:<key>'`** install on user documents with no UI path to set them —
  another product-exposure gap.
- **Composite arithmetic and nested function composition** (`ema(close,12)-ema(close,26)`,
  `sma(rsi(close,14),3)`) **already work in the underlying formula grammar and reach the real product
  path today** — a real MACD-shaped 3-plot composite installed and passed a real save/reopen fidelity
  round-trip with zero new schema gaps. **This should NOT be called a BuilderSheet gap** — it is
  already exposed, via ordinary formula authoring, right now.

**The owner's own explicit instruction on RISK-029 stands, unqualified**: this is a
product-capability finding, **not** authorization to build a band/colorMode authoring UI. "A future
session proposing to 'just add a band-authoring UI since the schema already supports it' should read
this row and the owner's own words first."

**Nothing found in Phase Two changes this** — this review does not turn RISK-027 or RISK-029 into
remediation work; neither is currently materially blocking product validation.

## 7. Silent Failure / Wrong-Answer Inventory

| ID | Class | Current status | Risk |
|---|---|---|---|
| RISK-019 | Cutler's RSI shipped under Wilder's name — 525/2,748 sampled rows wrong-sided, universe-wide, caught only by a dedicated audit, not the ~9,600-test standing suite | **Fixed, closed (historical)** | The founding precedent for this whole vendor-parity program |
| RISK-020 | `single_candle`'s 0/0 division completed instead of refusing — 78 rows misclassified `doji` on one build | **Fixed, closed (historical)**, control test in place | Second independent instance of the identical failure shape |
| RISK-026 | AI concierge door (`definition_concierge.plan()`) silently substituted EMA for an unsupported indicator name, and separately fabricated a formula for a fully subjective prompt — both `ok:true` | **Fixed** (`_named_phrases()` pure-code excision + a required `unresolved` schema field), confirmed live on rerun. **Disclosed, not closed**: single-word unsupported names aren't caught by the two-or-more-word heuristic, and `unresolved` still depends on the model honestly self-reporting | **HIGH** (fixed with an explicitly disclosed residual boundary) — the clearest S1-adjacent finding in the register |
| RISK-021 | Pattern-engine: 8 detectors shipped fabricated statistics/false citations in member-facing narrative text (invented Bulkowski/Peter Brandt/Greg Morris/Edwards & Magee attributions, a wholly invented trader name, a narrative contradicting the detector's own gate constant); 6 detectors had zero liquidity floor; one detector renders a degenerate zero-width line | **Fixed for these 8. ~90 of ~100 registered detectors NOT yet swept** — "no evidence the untouched detectors are cleaner" | **HIGH — the largest unresolved silent-failure surface in the whole register by count** |

**Every fixed item above closed with a real regression** (a live rerun, a control test, or a
generalization test set never seen in fixtures) — none closed by inspection alone. **RISK-021's own
~90-detector gap is this review's single strongest signal for §9/§13.**

## 8. RISK-004 Diagnostic Decision

**Current reproducible truth, reconfirmed**: 21/48 base, 21/48 after assisted edits, **0 recovered**
by the assisted-edit mechanism (`BENCHMARK_REPRODUCTION.md`, reproduced independently twice).

**Decision: do NOT decompose yet — but not because evidence is missing; because no NEW evidence
bears on the question at all.** Lane A vendor-parity (rsi/atr/sma/ema/rma/hma/macd/stoch/adx-family/
wma) and the 8-script real-import compatibility work are both about whether an ALREADY-TRANSLATABLE
formula computes the right NUMBER or resolves through the real product door. RISK-004 is about
whether a script translates AT ALL — a disjoint axis. Nothing in this session's evidence moves that
number or explains why the assisted-edit mechanism recovers zero scripts.

**The decomposition plan already exists, twice, with a phrasing discrepancy disclosed rather than
silently resolved**: `PHASE_TWO_PLAN.md` §4 gives 9 categories (unsupported function / unsupported
syntax / parser limitation / parameter-input limitation / execution-policy limitation / data
limitation / translator semantic uncertainty / assisted-edit mechanism defect / correctly refused);
`DECISIONS.md` DEC-013 item 4 gives 8 (merging "unsupported function/syntax" into one). This reads as
unreconciled phrasing drift between the original decision and its later, more granular restatement,
not an intentional scope change — the 9-category version is treated as operative here since it is
the more recent and more granular. **Status: PLANNED, not started, per both documents.**

**If a future authorization proceeds with it**: the bounded diagnostic tranche is exactly what
`PHASE_TWO_PLAN.md` §4 already specifies — classify each of the 27 failing scripts into one of the 9
categories, with NO fixing, NO broadening of accepted syntax, and NO optimizing toward a headline
percentage blind to the resulting distribution. This review does not begin that tranche.

## 9. Real-World Priority Analysis — Ranked

Ranked by: (1) silent-wrong-answer risk, (2) # real scripts/users affected, (3) architectural
leverage, (4) compatibility improvement, (5) evidence confidence, (6) blast radius, (7) regression
risk, (8) UX impact.

1. **Pattern-engine Group 1-4 sweep extension** (~90 of ~100 remaining detectors). Dominates axis 1 —
   this is the only candidate on this list that is an ACTIVE, member-facing, fabricated-statistics
   class of silent-wrong-answer, not a translator refusal or an unverified-but-honest edge case.
   High evidence confidence (the method already found 4 real defects checking 8 detectors). Low blast
   radius (investigation + targeted per-finding fixes, proven pattern). Real exposure is platform-
   wide pattern detections, likely broader than the 27-script blind corpus.
2. **RISK-004 diagnostic decomposition** (classify the 27 failing scripts). Zero blast radius (pure
   analysis of existing translator output, no code change). High architectural leverage — directly
   informs which of every OTHER candidate on this list is worth doing next. Already twice-planned,
   immediately actionable, no new evidence-gathering prerequisite. Ranks below item 1 specifically
   because a translator refusal is, by construction, never a SILENT wrong answer (axis 1 is explicit
   about this).
3. **Another public-script corpus tranche** (extend the real-import Checkpoint-02 methodology to more
   real scripts beyond the original 8). Same proven methodology, moderate blast radius (findings may
   suggest future remediation, but this pass itself is discovery-only), extends real compatibility
   evidence with a track record of finding genuine, fixable gaps (as Checkpoint 02 did).
4. **Remaining vendor-parity functions** (extend Lane A past its original 10-function list to the
   other ~48 of 64 manifest functions — e.g. CCI, Williams %R, MFI, Donchian, Ichimoku, OBV, VWAP).
   Low silent-wrong-answer risk relative to item 1 (these already pass dual-kernel and internal
   corpus checks; vendor-parity adds external confirmation, valuable but not urgent), good evidence
   confidence and architectural leverage (same proven methodology and tooling), zero regression risk.
5. **The Support Resistance Channels `pine:reassign` limitation** (the 2 identifiers, `resistance
   broken`/`supportbroken`, outside the currently-offered set). Narrow real impact (one script, two
   identifiers, on an ALREADY 6/6-clean script for its offered set). Ranked last because scoping it
   properly requires its own investigation before committing to a bounded tranche — reassignment/
   expression-folding could be a narrow fix or could open a materially larger architectural question,
   and that is not yet known.

## 10. Product Capability Map

**WHAT UCT CAN ALREADY DO WELL**: 16 of 64 manifest functions now real-vendor-confirmed correct
(§1/§2); the full RSI/ATR/SMA/EMA/RMA/WMA/HMA/MACD/Stoch/ADX-family stack matches real TradingView
output at float precision once past each function's own honestly-measured convergence boundary; 5 of
8 real public-community scripts fully import, save, reopen, and compute correctly end to end; JS/
Python dual-kernel agreement holds for every closed-table function this review checked.

**WHAT UCT CAN DO BUT THE UI DOES NOT EXPOSE**: band-style plots and sign/column-based color modes
(schema-valid, document-persistable, confirmed by real validated documents — no authoring control
exists in `BuilderSheet.jsx`, and no decision has been made to build one — RISK-029).

**WHAT UCT CORRECTLY REFUSES**: asymmetric `ta.dmi(diLen,adxLen)` pairs; array/collection usage
(Daily/Weekly/Monthly H/L); top-level external-library imports (ZigZag++); QQE's lagged self-
reference inside a `min`/`max` arm (a soundness-proof boundary, not an oversight).

**WHAT UCT PARTIALLY SUPPORTS**: QQE MOD (3/6 offered columns); Support Resistance Channels (6/6 of
its OFFERED set, but 2 additional identifiers outside that set remain blocked).

**WHAT UCT DOES NOT YET SUPPORT**: `input.string`/`input.source`/`input.timeframe`/`input.symbol`/
`input.time`/`input.color`, switch/branch-driving inputs beyond a plain boolean, numeric `options`
enums, bar-displacement inputs, `fill:{with}` rendering (schema-valid, confirmed non-rendering
regardless of UI), 48 of 64 manifest functions not yet vendor-parity-tested.

**WHAT REMAINS UNVERIFIED**: `rising`'s NA-skip convention (real data never exercises it); the true
historical initialization origin of ATR/EMA/RMA (decades before any capture this program can take);
ADX's zero-denominator and Stoch's zero-range fallback (never occur in real market data); ~90 of ~100
pattern-engine detectors' own narrative-fabrication/liquidity-floor/event-semantics risk.

## 11. Test-Credibility Update

Against `TEST_CREDIBILITY_FINDINGS.md`'s own 4 recommendations:

1. **State the self-agreement-vs-vendor-parity distinction in writing** — **NOT closed** this
   session; no evidence either `BENCHMARK_REPRODUCTION.md` or `CURRENT_ARCHITECTURE.md` was edited to
   add this explicit statement.
2. **Populate `tests/fixtures/vendor/observations/` with real vendor observations** — **substantially
   closed.** The assessment's own lead finding, quoted verbatim from its live run, was *"NO VENDOR
   OBSERVATIONS ARE HELD — 0 files."* This program now holds 18 real, raw-artifact-backed
   observations across rsi/atr/sma/ema/rma/wma/hma/macd(×3)/stoch/plusDI/minusDI/adx, plus the
   earlier Lane B set. **The single highest-leverage recommendation in that assessment moved from
   literally zero to complete Lane A coverage.**
3. **Add regression tests for RISK-012/RISK-013** — **NOT closed** this session; no evidence of new
   regression coverage for either specific browser-found bug this session.
4. **Extend the Group 1-4 pattern-engine sweep past 8 detectors** — **NOT closed.** No pattern-engine
   work happened during Lane A. Still ~90 of ~100 unswept (§7).

**Net**: the assessment's own #1-ranked lead finding is materially, substantially resolved. Its other
three recommendations are untouched. This review does not overclaim a broader credibility upgrade
than that.

## 12. Human QA Status — RE-EVALUATED, VERDICT UNCHANGED

Standing verdict, from `HUMAN_TESTING_READINESS_REPORT.md`: **"READY FOR LIMITED, ADVERSARIAL HUMAN
QA. NOT READY FOR, AND NOT RECOMMENDING, BROAD HUMAN ACCEPTANCE TESTING."** This verdict predates
ALL of Vendor Parity Tranche 2 (its own §8 sign-off states "Vendor Parity Tranche 2 is not started
and awaits separate authorization after this report is reviewed").

**This review does NOT silently promote to broad acceptance.** The verdict's own two independent
bases are: (1) a 9-item mechanical gate (all 9 met at the time of that report), and (2) the owner's
own explicit, independent DEC-013 cap ("LIMITED, ADVERSARIAL... NOT broad acceptance testing") — a
narrower instruction that is not superseded merely because more evidence has since accumulated.
**Nothing discovered in Phase Two changes the verdict itself.** What HAS changed is the evidentiary
basis cited for one gate item: item 2 ("core vendor-observation store populated") was evidenced by
"4 observations" when that report was written; it is now 18. This review records that the underlying
evidence has grown, not that the gate needed re-passing or that the verdict should move.

**Standing verdict re-affirmed, unchanged: READY FOR LIMITED, ADVERSARIAL HUMAN QA ONLY.**

## 13. Recommended Next Tranche

**Recommended: the Pattern-Engine Group 1-4 Sweep Extension.**

**Why it outranks the alternatives**: it is the only candidate that scores highest on axis 1 (silent-
wrong-answer risk) by a wide margin — every other candidate in §9 is either a correct-refusal
question (RISK-004, QQE), an already-honestly-disclosed low-likelihood edge case (zero-denominator/
zero-range), or a discovery-only pass with no known active defect (another script corpus tranche,
more vendor-parity functions). This is the one item where real users are being shown fabricated
statistics and false citations RIGHT NOW, in a subsystem where the SAME proven method already found
4 real defects checking only 8 of ~100 detectors — and the test-credibility assessment's own
Recommendation #4 has been sitting open since Phase One.

**Exact scope**: apply the SAME Group 1-4 sweep methodology (narrative-fabrication check, liquidity-
floor check, event-semantics check, geometry/rendering check) already proven on the first 8
detectors to a BOUNDED next batch of the remaining ~90+ registered pattern detectors. Do not attempt
all ~90 in one pass — the original 8 were a deliberately small, high-signal batch; the next batch
should be similarly bounded and named explicitly before starting (e.g. the next 10-15 highest-
traffic or highest-confidence detectors).

**What it must NOT expand into**: no changes to the pattern-detection ALGORITHMS themselves beyond
what a specific finding requires (e.g. removing a fabricated citation, adding a liquidity floor,
fixing a degenerate geometry) — this is a narrative/data-integrity sweep, not a pattern-recognition
redesign. No expansion into the Universal Indicator Ecosystem's own Pine/thinkScript/TC2000
translator work (a different subsystem). No touching Track F, QQE, BuilderSheet, or the vendor-
parity program.

**Stop conditions**: stop and report after the bounded batch is swept, whatever the finding rate; do
not silently expand to "just do a few more" without a fresh, explicit authorization, mirroring every
other tranche in this program's own discipline.

**Expected evidence produced**: a per-detector pass/fail table (narrative accuracy, liquidity floor,
event semantics, geometry), a count of new defects found (if any) with the SAME rigor as the original
8 (real reproduction, not inspection), and fixes + regression tests for whatever is found, following
the same "found and fixed same day" pattern the original 8 established.

**Likely impact on real public-script compatibility**: **none directly** — this is an adjacent
subsystem (pattern detection, not custom-indicator translation), sharing this program's risk register
and general discipline but not its translator/vendor-parity machinery. This is disclosed plainly: the
recommendation is ranked #1 on pure risk-evidence grounds, not because it advances the Pine/
thinkScript/TC2000 compatibility work this program has otherwise been doing.

**This tranche is NOT begun by this review.** It is a recommendation only, pending owner/ChatGPT
authorization.

## 14. Document / Commit

This document. `RISK_REGISTER.md`/`VALIDATION_COVERAGE_MAP.md`/`PHASE_TWO_PLAN.md` are NOT amended
by this review — every fact synthesized here was already correctly recorded in those documents at
the time of writing; this review is a synthesis and cross-check, not a correction pass, except for
the RISK-027/RISK-029 framing correction in §6, which is recorded here rather than by editing either
row (both rows' own text is already accurate; the error was in how this review's own originating
instructions characterized them, not in the register itself).
