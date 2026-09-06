# Human Testing Readiness Report

Produced per `PHASE_ONE_PLAN.md`'s "Release / Human-QA readiness gate" and Phase Two authorization
(`DECISIONS.md` DEC-013, item A: "automate Journeys #1–3 FIRST... then produce
`HUMAN_TESTING_READINESS_REPORT.md`"). This is the first version of this document — it did not exist
before this pass because item 8 of the 9-item gate (below) was not met until now.

**Verdict: READY FOR LIMITED, ADVERSARIAL HUMAN QA. NOT READY FOR, AND NOT RECOMMENDING, BROAD HUMAN
ACCEPTANCE TESTING.**

This verdict has two independent bases, stated separately so neither is mistaken for the other:

1. The mechanical 9-item gate below is now fully met (item 8 was the last open item; this pass closes it).
2. Independent of the gate's own three-way vocabulary, the owner's Phase Two authorization (DEC-013)
   already, explicitly, capped the next human-facing step at "LIMITED, ADVERSARIAL human QA — NOT broad
   acceptance testing," and named broad human acceptance testing on its own no-go list. That decision is
   not superseded by the gate closing — it is a narrower, more specific instruction, and this report
   honors it rather than treating a closed mechanical gate as authorization to override it.

---

## 1. The 9-item gate, re-evaluated against current evidence

| # | Gate item | Status | Evidence |
|---|---|---|---|
| 1 | All five doors through ≥1 real E2E Golden Journey | **Met** | Journeys #1–3 (Pine/thinkScript/PCF, this report §2) + #4–5 (plain-language/screenshot AI doors, `GOLDEN_JOURNEY_04_05_LIVE_RESULTS.md`) |
| 2 | Core vendor-observation store populated | **Met** | Track A — 4 observations, raw-artifact-backed (`tests/fixtures/vendor/observations/`, `tests/fixtures/vendor/raw_captures/`) |
| 3 | No known critical silent semantic wrong-answer defect | **Met, with disclosed residuals (§4)** | Track E's semantic-safety defect (unsupported-name silent substitution + ambiguous-language silent guessing) — found, fixed with two generalized non-blacklist mechanisms, proven live on rerun |
| 4 | RISK-016/RISK-012-class member-facing defects fixed with regressions | **Met** | Track B |
| 5 | Five-event telemetry operating | **Met** | Track C |
| 6 | Existing Screener/Saved-Screen preservation checks green | **Met** | 498 tests, 0 failed, across every suite touching the AI-door code paths (Track E completion pass) — no product code has changed since, only documentation and new standalone tooling (confirmed via `git diff --stat`, this pass) |
| 7 | RISK-003 resolved or precisely isolated | **Met** | Track D — VERIFIED HEALTHY, third pass, `scan_coverage.MAX(as_of)=20260904` across 4 scan definitions, full 3,742-ticker universe, gap-free (`tools/track_d_risk003_probe.py`) |
| **8** | **Critical browser journey suite automated** | **Met — closed by this pass** | `tools/golden_journey_pine_thinkscript_pcf.py`, §2 below |
| 9 | Validation Coverage Map updated | **Met** | `VALIDATION_COVERAGE_MAP.md` |

Item 8 is the one this report exists to close. Before this pass, Journeys #1–3 were one-off manual
live-browser sessions with no standing, re-runnable guarantee — they could silently regress with nothing
catching it. That gap is now closed.

---

## 2. Journey #1–3 automation evidence

`tools/golden_journey_pine_thinkscript_pcf.py` drives a real headless Chromium browser through the exact
chain each manual `CORE_GOLDEN_JOURNEY_0{1,2,3}` document walked by hand: paste → detect → translate →
canonical representation → validation → preview → save → reload → My-Formulas listing → screener gate →
negative-path refusal, for Pine (RSI), thinkScript (ADX/DMI), and TC2000/PCF respectively. No step was
shortened into a synthetic happy path; every journey still exercises save/reload/screener behavior through
the real UI, per the owner's explicit instruction while authorizing this work.

**Reproducibility, measured, not asserted once:** 5 total runs during this pass. Run 1–2 surfaced two real
harness bugs (a Playwright locator ambiguity, and a missing page navigation) — both fixed. Run 3 then
surfaced one real flaky race (the screener's saved-scans list finishing its client-side fetch after
`domcontentloaded`) — fixed by polling for concrete DOM evidence instead of a fixed sleep. **Runs 3, 4, and
5 — three consecutive runs on the current code — all passed clean, each against a freshly-launched,
independent, throwaway sandbox** (a new isolated backend, a new admin account, on a new port, torn down
after each run). No shared state between runs; nothing about a pass depends on a prior run's leftovers.

**Non-vacuous, at every step, with real evidence values:**
- Pine: canonical `rsi(close, 14)`, readback "the 14-bar RSI of close", non-repainting badge, "Saved —
  version 1, rev 1.", persistence survives reload, numeric artifact correctly refused by the screener
  ("this tree returns a number, not a 0/1 column..."), a boolean sibling (`rsi(close,14) > 50`) correctly
  accepted as a filter, negative path (`ta.cmf(20)`) correctly refused (`guard: canonicalise:member`) with
  Save disabled.
- thinkScript: correct dialect detection, DI+/DI-/ADX translated to real `rma(...)` expressions, full
  plain-English readback, non-repainting badge, save/reload/listing all correct, screener correctly refuses
  the numeric ADX artifact, and the negative-path fixture reproduces the exact **two sequential, distinct**
  refusals the manual doc found (`thinkscript:arity` with an assisted-edit offer, then `thinkscript:aggregation`
  with none) — proving the assisted-edit mechanism is real and the second refusal is a genuinely different
  gate, not a repeat of the first.
- PCF: dialect correctly detected, readback matches the corpus's own declared expected native exactly,
  accepted directly as a screener filter with no threshold required (the provably-binary-tree path), negative
  path (`FibExtension(...)`) correctly refused (`guard: pcf:name`).

**Journey #3's numeric assertion is genuinely point-in-time deterministic — the specific item the owner
flagged for scrutiny.** Every run: fetches SPY's real current daily bars from the running backend, extracts
the exact formula string the browser itself produced (never a hand-built AST), evaluates it through the
product's own JS interpreter (`readFormulaSource` + `interpret` from `app/src/components/chart/engine/ast/`,
executed in a real Node subprocess — the same code the browser runs), and independently recomputes the same
boolean via from-scratch pandas SMA(50)/SMA(200)/close math with zero reference to the product's interpreter.
Latest run: both oracles agree at exactly `1.0` against real data (close 770.19 > SMA50 756.86 > SMA200
712.15, bars ending 2026-09-04). No hardcoded value anywhere; the assertion is recomputed fresh every run
against whatever the market actually did.

**One disclosed documentation correction made in the course of this work, not a product defect:**
`CORE_GOLDEN_JOURNEY_01`'s claim that `LEVELS` auto-populates ("70, 30") on a fresh Pine import does not
match current code — `BuilderSheet.jsx` only populates `LEVELS` when reopening an already-saved definition
off its persisted `hlines` guide plot, never on a fresh `PineBox` pick. Checked against `DECISIONS.md` and
every spec/plan/risk-register entry: no durable decision ever required fresh-import auto-population, `git
log -S "setLevelsText"` shows the feature was built for save/reopen from its origin (not a regression), and
`pine.js` deliberately classifies a script's own `hline()` calls as a visual-only pragma, never translated
into a levels array. **Classified DOCUMENTATION DRIFT, not a product defect.** `CORE_GOLDEN_JOURNEY_01_PINE_RSI_IMPORT.md`
and `PHASE_TWO_PLAN.md` are corrected in this same pass (append-style, preserving the original claim
struck through with the correction, matching this doc set's existing convention) to distinguish fresh-import
(LEVELS starts blank) from reopen (LEVELS restores from the saved guide plot). No product code was changed
to manufacture agreement with the original claim.

---

## 3. Track E — real live-model evidence (summary; full detail in `GOLDEN_JOURNEY_04_05_LIVE_RESULTS.md`)

A scoped, isolated-environment-only Anthropic dev/test credential (never production, never a member's) ran
two live sessions. The first (6 failed, 1 passed) traced to a test-fixture defect — zero real model calls
occurred for any of the six failures. Fixing it exposed two real, independent product defects (unsupported
named-function silent substitution; ambiguous-language silent guessing), fixed with two generalized,
non-blacklist mechanisms (`_named_phrases()`, a required `unresolved` self-report field), each proven both
by adversarial non-live tests using prompts never seen in any fixture and live on the corrected rerun: **7
passed, 0 failed**, including both previously-failing cases now behaving correctly on real model output.

## 4. Track D — production-health evidence (summary)

Third-pass probe (`tools/track_d_risk003_probe.py`) against the real Railway production database:
`scan_coverage.MAX(as_of)=20260904` across 4 independent scan definitions, each evaluating the full
3,742-ticker universe, gap-free run history, non-zero `scan_hits`. RISK-003 status: **RESOLVED — VERIFIED
HEALTHY**.

---

## 5. Remaining known limitations (disclosed, not hidden)

- **Single-word unsupported named indicator not caught.** The `_named_phrases()` mechanism catches
  two-or-more-word proper-noun-shaped runs (e.g. "McGinley Dynamic"); a single unsupported word (e.g.
  "Aroon" if it were unsupported) is not caught by that heuristic alone. The `unresolved` self-report field
  is the backstop for this case, but is dependent on the model honestly reporting its own uncertainty — not
  proof against a model that confidently mis-reports `unresolved: []`.
- **Journeys #4/#5 (plain-language, screenshot doors) are automated but not routinely run** — they require
  a scoped, cleared-after-use credential, so they run on-demand rather than in CI. One phrasing per failure
  class was exercised live; broader generalization (10 additional novel phrasings) was proven non-live only.
- **Journeys #1–3's automation is new** (this pass) — it has 3 consecutive clean runs, not yet weeks of
  standing CI history. It is not yet wired into a scheduler; that is a reasonable near-term follow-up, not
  a blocker to limited QA.
- **Track F (parameter adjustability) is narrow v1**, `input.int`/`input.float` only. RISK-013 remains open
  for `input.bool`/`string`/`source`/`timeframe`/`symbol`/`time`/`color`, enums, and displacement — frozen,
  no broadening authorized.
- **RISK-004** (the Pine assisted-edit floor test being red on the automated blind corpus) remains open; a
  bounded diagnostic decomposition is authorized (Phase Two, not yet started) but not a blocker to limited,
  scoped human QA of the paths that ARE covered.
- **Chart-delivery numeric plausibility for continuous-valued oscillators (RSI, ADX)** is checked for
  sanity (correct band, live recomputation on reload) but not independently recomputed to exact numeric
  precision — only the PCF/binary case (Journey #3) has an exact, dual-oracle numeric proof, because only a
  0/1 flag admits one without a second, independent interpreter implementation to cross-check against.
- **RISK-018a's raw-artifact upgrade covers vendor SEMANTIC truth, not vendor PARITY** — the distinction
  Phase Two explicitly preserved; parity work (Tranche 2) has not started.

---

## 6. Exact scope of what LIMITED, ADVERSARIAL human QA may exercise

Per Phase Two's authorization (DEC-013), scoped to the doors and journeys with current, real, evidence-backed
coverage:

- **Pine, thinkScript, and TC2000/PCF import** through the Import tab — paste, translate, save, reload,
  screener use — for scripts resembling the corpus already exercised (real vendor indicators, not
  arbitrarily exotic ones).
- **The plain-language (AI concierge) and screenshot doors** — bounded to prompts/images broadly similar in
  shape to what Track E's live and non-live evidence covers (named indicators, simple conditions, common
  chart screenshots); testers should be told this is not yet proven against open-ended adversarial phrasing
  beyond what's documented.
- **Save/reload/My-Formulas/screener-gate behavior** generally, for artifacts built through any of the five
  doors.
- **Adversarial intent is explicitly welcomed** within this scope — trying to break translation, trying
  unsupported names, trying ambiguous language, trying to get a numeric artifact past the screener gate —
  this is exactly the kind of testing the existing negative-path and semantic-safety evidence was built to
  survive, and finding a NEW failure mode here is a successful outcome of this QA round, not a sign
  something is broken that shouldn't be tested.

## 7. Explicit exclusions from this QA round — not in scope

Matching Phase Two's no-go list exactly — none of the following should be exercised, reported as a QA
finding, or treated as in-scope by testers in this round:

- **Broad, unscoped human acceptance testing** — this round is limited and adversarial-but-bounded, not an
  open invitation to test the entire product surface.
- Pine `input.bool`/`string`/`source`/`timeframe`/`symbol`/`time`/`color` parameter adjustment (Track F is
  frozen at `int`/`float` only).
- Any attempt to exercise real screener SWEEP EXECUTION or SCAN_LIVE_SWEEP_ENABLED — this remains
  architecturally forbidden from any request path, enforced by test, not a feature gap to probe.
- The full-universe intraday scanning vertical, or any new scripting-language capability — out of scope for
  this entire phase.
- Canonical-AST rewrite, execution-kernel replacement, or tech-stack modernization — not in scope for human
  QA at all; these are engineering-only concerns.
- Vendor Parity Tranche 2 work (ranking or implementing the four newly-authorized Track A functions) — not
  yet started, not part of this QA round.

---

## 8. Sign-off

Gate: **9/9 met.** Verdict: **READY FOR LIMITED, ADVERSARIAL HUMAN QA — explicitly NOT broad human
acceptance testing**, per both the gate's own vocabulary and the owner's more specific standing Phase Two
scope decision. Vendor Parity Tranche 2 is not started and awaits separate authorization after this report
is reviewed.
