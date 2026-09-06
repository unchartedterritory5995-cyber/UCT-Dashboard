# Vendor Parity Tranche 2 — Readiness Report (First Return)

Per `PHASE_TWO_PLAN.md` §2 and DEC-013 item 3. Read-only investigation against current repo state —
no implementation performed yet. This is the checkpoint the authorization asked for before a large
tranche begins.

## 1. Re-confirmed priority ranking and evidence — a real discrepancy found

The authorizing message this turn stated "current reported priority order: 1. hma 2. macd 3. stoch
4. adx-family 5. wma." **That is not `PHASE_TWO_PLAN.md`'s actual ranking — it is items #6–10 of a
committed top-10 list, omitting the top 5.** Verified directly against `PHASE_TWO_PLAN.md` §2's own
table (`rsi` → `atr` → `sma` → `ema` → `rma` → `hma` → `macd` → `stoch` → `adx`-family → `wma`), and
against `tests/fixtures/vendor/observations/` (only the 4 Lane B functions have any real capture —
**zero real vendor observations exist yet for rsi/atr/sma/ema/rma or hma/macd/stoch/adx/wma**, so
nothing about implementation readiness favors starting at #6).

The top of that list is not a placeholder ranking — `rsi` (#1) is the **only function on the entire
64-function manifest with a confirmed production incident** (RISK-019: Cutler's RSI shipped under
Wilder's name, 525/2,748 rows wrong, caught by a dedicated audit — **not** by a real vendor capture,
so no real-runtime confirmation of the fix exists yet). `atr` (#2) has an **already-adjudicated**
divergence on file (`divergences.json::atr-tr-starts-at-bar-1`, ruled 2026-08-29, "KEEP OURS") that
was reached via a spec-level probe, not a real TradingView runtime capture — a real capture is the
one form of evidence that ruling's own "what would reopen it" clause names.

**Recommendation, and what this report proposes to execute first: `rsi` and `atr`**, not
hma/macd/stoch/adx/wma. This is not a rejection of the authorized scope (Lane A) — the four names in
the authorizing message ARE 4 of the 10 authorized functions, just not the evidence-ranked first two.
If there's a reason to prefer hma/macd/stoch/adx/wma specifically that this repo's evidence doesn't
capture, that's a one-line correction; absent one, proceeding on the re-confirmed evidence order
avoids "does not blindly inherit a stale list" turning into exactly that.

**A second, related finding:** `hma`'s listed justification ("MEASURED divergence... never checked
against real TradingView") does not match `divergences.json::hull-half-window-floors`, whose status
is **`confirmed` — i.e. AGREEMENT**, not an open divergence (the near-miss was in a piece of *advice
text* telling members to write the wrong formula, already fixed 2026-08-29; the `hma` implementation
itself was never wrong). A real capture for `hma` would be a nice-to-have confirmation via real
runtime, not a resolution of an open question — correctly still worth doing eventually, just not
mis-stated as urgent for the same reason `rsi`/`atr` are.

## 2. Functions selected for the first parity batch

**Lane A, first batch: `rsi(close, 14)` and `atr(14)`.** Two functions, not the full ten — small
enough to prove the pattern end-to-end (capture → compare → classify → observation → regression)
without the scope this authorization explicitly bounds against. Both already have a real, named,
open evidentiary question (§1) that a real capture directly answers.

**Lane B, full authorized set: `ta.rising`, `ta.median` (even-length), `ta.percentrank`, `ta.bbw`** —
exactly the four named, no more. Their raw vendor artifact already exists
(`tests/fixtures/vendor/raw_captures/2026-09-05-tv_oracle_capture_2026-09-05.csv`) and their semantic
rulings are already recorded (`RISK_REGISTER.md` RISK-018a) — **no new browser capture needed for
Lane B**; the remaining work is implementation + conformance + comparison + regression.

## 3. Current UCT implementation paths

| Function | JS (`interpret.js` binds to) | Python | Status |
|---|---|---|---|
| `rsi` | `computeRSI` in `app/src/components/chart/indicators.js:83` (Wilder, seeded on the simple mean of the first `period` gains/losses) | `_fn_rsi` in `api/services/ast_interpret.py:1239` | Implemented, RISK-019-fixed |
| `atr` | `computeATR` in `app/src/components/chart/indicators.js:336` (Wilder over True Range from bar 1) | `_fn_atr` in `api/services/ast_interpret.py:1261` | Implemented, divergence already adjudicated (§1) |
| `ta.rising` | not declared in `closedTable.json` | not declared | **Not implemented — Lane B work** |
| `ta.median` (even-len) | not declared | not declared | **Not implemented — Lane B work** |
| `ta.percentrank` | not declared | not declared | **Not implemented — Lane B work** |
| `ta.bbw` | not declared | not declared | **Not implemented — Lane B work** |

(`hma`/`macd`/`stoch`/`adx`+`plusDI`+`minusDI`/`wma` are all already declared and implemented too —
confirmed via `closedTable.json` — so implementation readiness is not what's gating their order.)

## 4. Exact TradingView oracle scripts/expressions

- `rsi`: `plot(ta.rsi(close, 14))` — matches UCT's `rsi(close, 14)` exactly, no translation ambiguity.
- `atr`: `plot(ta.atr(14))` — matches UCT's `atr(14)`; `ta.atr` is internally `ta.rma(ta.tr(true), 14)`
  per Pine's own docs, which is precisely the bar-0 TR question already on file (§1) — the capture
  should read the value at an EARLY bar (e.g. bar 14/15 of the visible series) AND at a late bar
  (e.g. bar 200+) specifically to test the "decays to invisible" claim already on record, not only
  read one steady-state point.
- Lane B (already captured; restated here for completeness): `ta.rising(close, N)`, `ta.median(...)`
  over an even-length window, `ta.percentrank(close, N)`, `ta.bbw(close, N, mult)` — see
  `tests/fixtures/vendor/raw_captures/2026-09-05-tv_oracle_capture_2026-09-05.csv` for the exact
  scripts already run.

## 5. Data/input strategy

Same symbol/session as the existing Track A raw capture for continuity and to reuse the
already-authenticated TradingView session (TV Plus tier, re-verified 2026-09-06 -- prior notes had assumed "Premium"; CSV export is confirmed available on Plus, which is what actually matters here): **SPY, Daily.** Real market data (not
synthetic) — matching this program's own established preference for real vendor-runtime evidence
over synthetic series, and because `atr`'s open question is specifically about bar-0 alignment on a
real series, which a synthetic series would not exercise identically to production charts. Capture
window sized to read BOTH an early bar (to see the seed/alignment question directly) and a bar deep
enough into the series (200+) that the decay claim in `divergences.json` can be checked, not assumed.

## 6. Artifact capture strategy

Reuse `tools/track_a_ingest_vendor_capture.py`'s proven pattern exactly (cross-validation,
control-value checks, raw-artifact preservation) — this is Track A's own stated mechanism for this
generalization, not a new tool. CSV export via the account's TV Plus tier (confirmed active 2026-09-06), preserved
verbatim under `tests/fixtures/vendor/raw_captures/`, referenced from each observation's
`provenance.rawArtifact` exactly as the existing 4 Lane B observations already do.

## 7. Comparison/tolerance methodology

Compare UCT's `interpret()` output (both JS and Python lanes, which are already required to agree
with each other at 1e-9 — that is dual-kernel conformance, not vendor parity, and stays a separate,
already-existing check) against the captured real vendor values at IDENTICAL bar indices. Tolerance
proposal: **1e-6 relative** for steady-state bars (well past any warm-up), reported alongside the
raw absolute delta — not a single pass/fail number, so a genuinely-decaying seed difference (as
`atr` already has one on record) is visible as a number, not swallowed into a boolean. Warm-up bars
(the first `period` for each function) are compared and reported SEPARATELY, explicitly labeled, per
§9 below — never silently excluded, but also never allowed to fail a check whose actual claim is
about steady-state agreement.

## 8. Warm-up/session/timeframe handling

Both `rsi` and `atr` have a `period`-bar warm-up by construction. The comparison harness will report,
per bar: `{index, uct_value, vendor_value, delta, is_warmup}` — an explicit boolean, not an implicit
row-count mismatch a reader has to infer. Session/timeframe is pinned to Daily bars, confirmed
sessions only (no partially-formed current bar) — the same "last CONFIRMED bar" discipline this
program has stated elsewhere (`scan_evaluator`'s own rule, `<tree> != 0` on the last confirmed bar).

## 9. Mutation/non-vacuity plan

Per-function, one deliberate perturbation proven to flip the check RED before it is trusted GREEN:

- **`rsi`**: temporarily swap `computeRSI`'s Wilder recurrence for a plain SMA-of-gains/losses in a
  throwaway copy fed to the SAME comparison harness — must fail, proving the harness actually reads
  the smoothing convention and isn't just checking "a number near 50-ish exists."
- **`atr`**: temporarily swap the True-Range max-of-three formula for a bare `high - low` in a
  throwaway copy — must fail, proving the harness isn't just checking "some volatility-shaped number."
- **Both**: a control run that feeds the harness UCT's OWN output as "the vendor value" must be
  REJECTED by construction (the harness refuses when `vendor_source == 'uct'`), directly guarding
  against the exact failure mode named in the authorization ("UCT output was accidentally substituted
  for vendor output").
- Empty/null-row handling: a row where the vendor artifact carries no value (a warm-up bar or a
  vendor-side gap) must be reported as `DATA BLOCKED` for that row, never silently skipped out of the
  denominator used for any summary pass rate.

## 10. Expected output files/observation schema

- `tests/fixtures/vendor/raw_captures/<date>-tv_oracle_capture_rsi_atr.csv` — new raw artifact.
- `tests/fixtures/vendor/observations/rsi-close14-<date>.json`,
  `tests/fixtures/vendor/observations/atr-14-<date>.json` — new observations, same shape as the
  existing 4 Lane B ones (`provenance`, `params`, `rows`, `control values`).
- `tests/fixtures/vendor/parity/rsi-close14-<date>.json`,
  `tests/fixtures/vendor/parity/atr-14-<date>.json` (new directory) — the actual UCT-vs-vendor
  numeric comparison result: per-bar deltas, warm-up flags, tolerance used, verdict.
- `tools/vendor_parity_compare.py` (new, small) — runs `interpret()`/`ast_interpret.interpret()`
  against an observation's bars and produces the parity file above; carries its own mutation tests
  (§9) in `tools/vendor_parity_compare_test.py`.
- A permanent regression, `tests/test_vendor_parity_rsi_atr.py`, asserting the parity file's verdict
  stays `VENDOR-PARITY VERIFIED` (or whatever it lands as) going forward.
- `RISK_REGISTER.md` gets `atr-tr-starts-at-bar-1` updated with the real-capture outcome (either
  "ruling CONFIRMED by real vendor runtime" or a new escalation if the real data disagrees with the
  spec-derived probe) — the ruling itself is not silently redefined either way (§ authorization).

## 11. Risks/blockers

- **The single largest real risk is exactly the one `atr`'s own decision record warns about**: reading
  a seed/alignment difference near the warm-up and mis-classifying it as a calculation defect. This
  report's §7/§9 design (explicit warm-up flagging, deep-bar sampling, mutation controls) exists
  specifically to prevent repeating that already-once-made-and-reverted mistake.
- TradingView session state (rate limits, plan changes) — none currently known, but Track A's
  capture already hit a Basic-plan 2-indicator cap once; the account is now TV Plus (re-verified
  2026-09-06, not "Premium" as earlier assumed), so this specific blocker is resolved.
- No blocker to Lane B implementation — raw artifacts and semantic rulings already exist; the work is
  bounded to implementation + conformance + comparison + regression for exactly 4 named functions.

## 12. Proposed sequence

1. Re-verify TradingView session/plan-tier status (cheap, first) -- DONE 2026-09-06: logged in, TV Plus confirmed, CSV export available via Table View, chart state unmodified.
2. Capture `rsi(close,14)` and `atr(14)` on SPY Daily, preserving the raw artifact, reading both an
   early and a late bar.
3. Ingest via the generalized `track_a_ingest_vendor_capture.py` pattern → two new observations.
4. Build `tools/vendor_parity_compare.py` + its mutation tests (§9) — prove it can fail before trusting
   it to pass.
5. Run the real comparison for `rsi` and `atr`; classify any delta per the 8-category list in the
   authorization (data/warm-up/calculation/smoothing/session/execution-state/vendor-ambiguity/UCT-defect)
   before touching any product code.
6. Record parity observations + permanent regressions; update `RISK_REGISTER.md`'s `atr` divergence
   entry with the real-runtime outcome.
7. Only then begin Lane B: for each of the 4 named functions, implement in both `interpret.js` and
   `ast_interpret.py`, run dual-kernel conformance, run the same parity-comparison mechanism against
   the already-existing raw artifact, record the observation + regression.
8. Report back with the completed Tranche 2 evidence chain for both lanes.

**Stop conditions restated as understood:** escalate rather than proceed if a real capture shows
vendor behavior genuinely ambiguous (not just noisy), if `rsi`/`atr` input equivalence can't be
established (e.g. a session/adjustment mismatch), if any of this expands past the 2 Lane-A + 4 Lane-B
functions named here, or if anything requires touching `interpret.js`/`ast_interpret.py`'s existing
`rsi`/`atr` implementations to "fix" a delta the classification step hasn't first understood.
