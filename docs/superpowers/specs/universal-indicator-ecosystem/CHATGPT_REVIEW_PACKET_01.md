# ChatGPT Review Packet #1 — Universal Custom Indicator + Screener Ecosystem, Phase Zero

Produced 2026-09-04, at the explicit checkpoint gate: all five Core Golden Journeys and the data/timeframe/
execution audit have landed, along with test-credibility, telemetry, screener-preservation, and production-
verification tracks (P1-P6 in full). Every claim below traces to a specific committed document, a live tool
run, or a direct code citation in this worktree (`C:\Users\Patrick\uct-dashboard\.claude\worktrees\
indicator-ecosystem`, based on `origin/master` @ `12cf5c8d3`). Per the master prompt's own instruction, this
packet does not propose an "ultimate tech stack" — nothing found in Phase Zero constitutes evidence that any
core architectural component needs replacing; where that question comes up (§19) it is answered honestly as
"not found," not manufactured.

---

## 1. VERIFIED CURRENT ARCHITECTURE

One canonical pipeline, five input doors, confirmed shipped and confirmed live in a real browser for three
of the five doors (Golden Journeys #1-#3), confirmed at the code level for the remaining two (§3):

```
Pine / thinkScript / TC2000-PCF source text, or a plain-language request, or a screenshot
                              │
        dialect-specific parser + semantic lowering (pine.js / thinkscript.js / pcf.js /
        definition_concierge.py NL pipeline / indicator_from_image.py vision pipeline)
                              │
                    ONE canonical AST (jsep-derived: num/series/op/call nodes)
              — persisted verbatim; raw source text is transient, never saved —
                              │
         manifest-driven static analysis (closedTable.json → lint.js/ast_lint.py repaint
                    decidability, budget.js/ast_budget.py node/lookback caps)
                              │
      TWO synchronized execution kernels, cross-checked at 1e-9 tolerance
      (interpret.js in JS, ast_interpret.py in Python — tools/ast_conformance.py verifies)
                              │
        ┌──────────┬──────────────┬───────────────┬────────────────────┐
     chart adapter  screener adapter  alert adapter   AI concierge (reuses
                                                        the identical schema→
                                                        canonical→budget→
                                                        lint→compute pipeline)
```

The one write door for member-authored definitions is `BuilderSheet.jsx` →
`nativeRegistry.installUserDefinitions`. Nothing downstream re-parses source text; every consumer reads the
same persisted AST. **This is a shipped instance of "one grammar, many surfaces," not an open research
question** — confirmed architecturally (wave-one archaeology) and now confirmed live, in a real browser,
across three different source languages hitting the identical numeric-vs-boolean screener gate (§3, §4).

The manifest is `app/src/components/chart/engine/ast/closedTable.json` (169KB): one writer, two runtime
readers (JS + Python), each AST-walked by its own test forbidding a hand-copied vocabulary string outside
the manifest — a real anti-drift mechanism. `vocabulary.js` generates member-facing docs from it;
`definition_concierge.py`'s AI tool schema is separately generated from the same source.

**Phase-by-phase status** (7/31 design doc's own labels, corrected against `origin/master`):

| Phase | Status |
|---|---|
| A — Signature Launch | **Shipped.** Grew beyond its own plan (`confluence.py`'s unwired `dpc-v1`, `registry_defs.py`). |
| B — Foundation (engine/binding) | **Shipped and unconditionally active on every chart** — not a shadow path; the cutover flag was deleted at all 7 sites once complete. |
| C — Alerts & depth | **Shipped.** Closed-bar evaluation confirmed at `indicator_alert_evaluator.py:134`. |
| D — Builder + AI door | **Shipped.** Full `cost → generate → schema → canonical shape → budget → lint → compute → read back` pipeline implemented. |
| E — Screener & toolkits | **Mechanism shipped, commercial tiering deliberately open** (`entitlements.TOOLKITS` currently one ungated toolkit — a known, flagged, already-open owner decision, not a silent gap). |

Three "live" scanning-adjacent systems exist and must not be conflated (new this wave, `DATA_EXECUTION_
FINDINGS.md`, §10): a retired client-side tab (gone), the **Screener Live Tier** (armed and live in
production today, Finviz-style intraday overlay), and the **AST-scan live mode** (fully built, tested, and
dark — the subject of RISK-003/§13).

---

## 2. WHAT ALREADY EXISTS THAT THE MASTER PROMPT ASSUMED WAS FUTURE

- **The five-door unification itself** (§12, §14). The master prompt frames "one grammar, many surfaces" as
  a target architecture to work toward; it is already shipped, and this wave's Golden Journeys walked three
  of the five doors live end-to-end into the identical canonical AST and the identical screener gate.
- **MP-066** (docs generated from engine capability metadata) — already satisfied by `vocabulary.js` +
  `definition_concierge.py`'s tool-schema generation, predating this program.
- **MP-032** (Vendor Oracle Protocol) — the protocol and harness (`tools/vendor_truth.py`,
  `vendor_spec_probes.py`, the observations schema, anti-rot tests) are fully built and well-designed. The
  master prompt's framing implies this needs designing; it needs **populating** — a data-entry task against
  existing infrastructure (RISK-018, the single highest-leverage open item this program found).
- **The numeric-vs-boolean screener gate and "Honest-None" disclosure** (§17-19) — both already built,
  tested, and now confirmed live and door-agnostic, not merely aspired to.
- **On-demand ("Run Now") scanning** — already shipped, backend and frontend both, since 2026-08-25/26
  (`DATA_EXECUTION_FINDINGS.md`). The master prompt's intraday/on-demand framing (§10, MP-020) reads as an
  open research question; a bounded, paid-gated, self-healing version of it already exists in production.
- **A generic, already-live event-storage precedent** (`landing_events`, `ai_search_log`) that could carry
  most of the master prompt's 5-event telemetry minimum (§37) far more cheaply than designing new
  infrastructure — see §12.

---

## 3. GOLDEN JOURNEY RESULTS BY DOOR

Full detail in `CORE_GOLDEN_JOURNEY_01` through `_05`. Summary:

| Door | Result | Headline |
|---|---|---|
| **Pine** (#1) | **PASS, full E2E** | 97-line real vendor RSI script → correct canonical `rsi(close,14)` → chart → save → clean reload. Found RISK-012 (double-save duplicate) and RISK-013 (input fidelity gap). Negative path: unresolved property access correctly refused. |
| **thinkScript** (#2) | **PASS, full E2E** | ADX/DMI script, DI+ formula hand-verified algebraically correct. Screener gate confirmed door-agnostic (identical refusal message to Pine's numeric case). Negative path found **two distinct, more granular refusal mechanisms** than previously credited: a missing-default-argument case with an inspectable assisted-edit offer, and a missing-capability case with a correct hard refusal and no false offer — narrows RISK-004 without resolving it. |
| **TC2000/PCF** (#3) | **PASS, full E2E, strongest evidence of the three** | Translation matched the corpus's own declared expected answer exactly; rendered value (1.00) was independently *provably* correct, not just plausible, given SPY's visible MA state at the time. **A genuinely useful divergence, explained rather than assumed**: an AND-of-comparisons formula was correctly accepted as a screen without needing its own optional threshold-conversion helper — the gate is confirmed to be a pure output-type rule (`<tree> != 0`), not a per-door special case. Negative path: fabricated function name correctly refused with exact character position. |
| **Plain language** (#4) | **ENVIRONMENT-BLOCKED, live round-trip; real bug found on the way** | No `ANTHROPIC_API_KEY` in the isolated sandbox — a genuine, stated environment limitation, not worked around with a live key. Found and confirmed RISK-016: the frontend attaches the full cached bar buffer (8,000 bars for SPY) to the request, exceeding the server's 5,000-bar cap, producing a raw 400 that bypasses the endpoint's own documented refusal contract and misrepresents the cause to the member. "Interpretation visible" and "compilation is final authority" answered at the **code level only** (`sentence_for`'s determinism; `/propose` stores nothing, saves route through the same validation as any manual formula). |
| **Screenshot** (#5) | **ENVIRONMENT-BLOCKED, live round-trip; cleanly and honestly so** | `INDICATOR_VISION_ENABLED` unset — a deliberate, named, in-words-explained product gate, refused through the documented 200/`ok:false` contract (unlike #4's raw 400). The tab's own static copy — "a picture does not tell us the formula... best guess... pick one only if it matches" — **directly and live-confirms** the inference-vs-exact-translation mandate without needing the model call to work. Same `sentence_for`-derived read-back authority as the plain-language door, confirmed at the code level. |

**Explicit note preserved from the journey docs**: Journeys #4 and #5 hit walls short of a live model call,
but they are not the same *kind* of wall — one reveals a bug, the other reveals correct engineering
discipline being exercised on schedule. Collapsing both into "both AI doors are blocked" would lose real
signal.

---

## 4. EXISTING SCREENER/SAVED-SCREEN PRESERVATION BASELINE

Full detail: `SCREENER_PRESERVATION_BASELINE.md`. Terminology confirmed final ("Custom Screens" appears
nowhere in the codebase; real vocabulary is Screener → Screens ▾ → STARTERS/MY SCREENS/MY SCANS). The
numeric-vs-boolean gate confirmed door-agnostic across three languages (§3). The definition-edit route
(`PUT /{def_id}`) was found, on **direct re-verification**, to have a real product caller (`BuilderSheet`'s
Save button) and reasonable 400/404 error handling — **correcting** an earlier, less-precise internal note
that claimed otherwise (recorded as a correction, not silently dropped, per this program's own evidence
discipline). Its live browser exercise remains unverified regardless (pencil icon never clicked in any
journey).

Two real, previously-uncaught defects found and confirmed by direct code reading:
- **RISK-024**: `scan_store.prune()` is fully implemented and explicitly designed to ship wired from day
  one, but is not called anywhere in production.
- **RISK-025**: screen-alert subscriptions never check whether their underlying definition still exists, is
  soft-deleted, or was renamed before firing — a fresh instance of the exact silent-forever-pending failure
  class already fixed once for the screener-chip surface, unfixed here.

---

## 5. CURRENT VALIDATION COVERAGE MAP

Full map: `VALIDATION_COVERAGE_MAP.md` (46 rows). Headline distribution:

- **4 — End-to-End or higher, live-browser-confirmed** (14 rows): Pine/thinkScript/TC2000 → canonical AST
  for their specific fixtures; chart delivery; save/create/delete; the numeric-vs-boolean gate; screener
  reachability; four distinct negative-path cases; the nightly-snapshot ↔ AST-scan Honest-None join.
- **5 — Adversarial, and it failed** (1 row): Save double-submit — adversarial testing found RISK-012, and
  the map records the failure rather than omitting the row, per this program's own anti-paper-capability
  discipline.
- **1-2 — Unit/Integration only** (8 rows): the three translators' broad corpora, dual-kernel conformance,
  plain-language/screenshot doors (code-level), the nightly-snapshot query engine, the Base & Structure
  Library.
- **0 — Exists, unverified** (11 rows): screener execution with a populated result set, saved-artifact
  editing (live), alert creation, Structure Library rendering, cross-browser, mobile, production/staging
  behavior broadly.
- **New this wave**: a dedicated **vendor-parity** row, held at 0/Unit-partial and deliberately separate
  from the dual-kernel-conformance row, specifically to prevent the RISK-018 conflation risk from
  resurfacing silently in a future reader's mind.

**Read literally**: nothing in this map should be quoted as "N% verified" — it is a row-by-row ladder, and
the map's own stated purpose is to make the *shape* of confidence visible, not to produce one number.

---

## 6. CURRENT BENCHMARKS

Full detail and exact repro commands: `BENCHMARK_REPRODUCTION.md`. As measured live, 2026-09-04:

```
Pine               14/21  translate · 5 ruled · 0 offered · 2 OPEN
Pine (community)   19/30  translate · 7 ruled · 3 offered · 1 OPEN
thinkScript        10/24  translate · 5 ruled · 4 offered · 5 OPEN
TC2000 (PCF)       57/57  translate · 21 ruled · 0 OPEN

honest denominator (Pine+community+thinkScript, excluding permanent correct refusals): 43/58
end to end: 43 translate -> 43 evaluate -> 43 SAVEABLE (one flagged repaint caveat)
18 of 43 directly scannable; all 43 reachable as a screen with one added comparison
```

Two of five previously-cited numbers (43/58, 21/48) were exactly right; one ("28/48 after assisted edits")
is **currently false, and the repo's own test is red on it**; one is superseded by more current, more
conservative data (17/21 → 14/21).

**⛔ MANDATORY CAVEAT, per RISK-018 (§11) — read this before quoting any number above.** Every figure in
this section is a **self-consistency** measurement (a script parses, budgets, lints, and its own two
execution kernels agree with each other at 1e-9). **None of it is vendor-parity evidence.**
`tests/fixtures/vendor/observations/` holds zero real observations from an actual TradingView/thinkorswim/
TC2000 chart, confirmed live (`vendor_truth.py --check` exits 2, "0 files"). Only ~5 of 64 manifest
functions have any check against real vendor-published formula text. This is not hypothetical: this exact
conflation risk already produced two real, confirmed production incidents on the screener side (RISK-019
`rsi14`/Cutler-under-Wilder's-name, RISK-020 a doji/zero-range-bar misclassification) — both caught by a
dedicated accuracy audit, not by the ~9,600-test standing suite, which stayed green through both. **Any
future report, including a later version of this packet, must repeat this caveat wherever these numbers
appear, not just here.**

---

## 7. KNOWN BROKEN

Currently broken, confirmed live or by direct code reading, not yet fixed:

- **RISK-016** — both AI-touching doors share a bars-cap validation bug; live-confirmed on the plain-
  language door (a raw 400 that misrepresents its own cause), code-confirmed identical on the screenshot
  door.
- **RISK-012** — double-clicking Save duplicates a chart instance (browser-confirmed, S3).
- **RISK-024** — `scan_store.prune()` unwired; unbounded table growth in production with no current
  measured symptom.
- **RISK-025** — dangling scan-definition references in alert subscriptions; a deleted/renamed definition's
  subscription doesn't self-correct or self-disable.
- **RISK-017** — the on-demand scan door has no code-level intraday-timeframe refusal (currently safe only
  because the frontend dropdown doesn't offer one — a UI, not architectural, boundary).
- **RISK-022** — RISK-012 and RISK-013 both lack any backend regression test, so either could silently
  regress further or be reintroduced by an unrelated refactor.

**Already broken, now fixed — kept here for calibration, not as open items**: RISK-019 (`rsi14` universe-
wide misclassification), RISK-020 (doji/zero-range-bar misclassification), RISK-021 (8 pattern-engine
detectors' fabricated narrative statistics, a missing liquidity floor, a geometry bug) — all confirmed fixed
by their own accompanying control tests, all real, all worth knowing happened.

---

## 8. PARTIALLY VERIFIED

- **RISK-013** (Pine input-parameter fidelity) — confirmed for one fixture, likely general given the
  mechanism, not yet confirmed across other scripts.
- **RISK-004** (Pine blind-corpus assisted-edit floor) — confirmed red at the corpus level; narrowed, not
  resolved, by CGJ#2's live observation that the same UI mechanism works correctly for a different language/
  construct.
- **RISK-009** (TC2000 adversarial-corpus representativeness) — CGJ#3 verified one *ordinary* fixture
  end-to-end and it matched exactly; this doesn't touch the adversarial-corpus question RISK-009 is actually
  about.
- **Plain-language/screenshot "interpretation visible" and "compilation is final authority"** — both
  answered soundly at the code level (`sentence_for`'s purity, `/propose` storing nothing); neither observed
  running end-to-end with a real model response.
- **Pattern-engine narrative-fabrication risk (RISK-021)** — confirmed and fixed for 8 of ~100 registered
  detectors; the method is proven to find real defects; untested on the remaining ~90+.
- **`landing_events`/`signature/ledger.py` as telemetry precedents** — confirmed to exist, already live,
  already tested; not yet confirmed to actually close the 5-event gap once wired (a design/implementation
  step, not yet attempted).

---

## 9. UNVERIFIED

- **Screener execution against a populated, real-market-scale result set** — every Golden Journey observed
  only the empty-sandbox state; no journey observed the nightly sweep actually complete and a real match
  materialize.
- **Definition editing, live in a browser** — the pencil icon has been seen in every journey and clicked in
  none.
- **Alert creation** (`Indicator Alerts` dialog) and the **Structure Library dialog** — both seen by
  accident, neither exercised.
- **Cross-browser and mobile/responsive** — Chromium desktop only, throughout.
- **Production/staging behavior, broadly** — everything in this packet except RISK-003's specific Railway
  checks is local/sandboxed evidence (§13).
- **Whether `SENTRY_DSN` is actually active in Railway production** — source-only audit scope; would need a
  `railway variables` read, not performed.
- **Whether a session is currently active in the `indicator-endzone` worktree** (RISK-006) — unresolved
  from wave one, unchanged this wave.
- **The bars-cap bug (RISK-016) reproducing live on the screenshot door specifically** — confirmed identical
  at the code level; that specific request never reached the check live because the vision-disabled refusal
  fired first.

---

## 10. DATA/TIMEFRAME/EXECUTION FINDINGS

Full detail: `DATA_EXECUTION_FINDINGS.md` (P4). The nightly-only AST-scan boundary decomposes into six
distinct buckets, only two of which are genuine hard constraints:

| # | Layer | Bucket |
|---|---|---|
| 1 | Nightly full-universe sweep's cost | **Execution-engine limitation** — real, measured (GIL-bound threading tried and found to help nothing; would break the 1e-9 parity guarantee) |
| 2 | "Should scanning go beyond nightly" | **Product policy — already decided, YES** (2026-08-25 owner ruling; not an open question) |
| 3 | Continuous ~5-min sweep of the forming daily bar | **Scheduling — solved, gated by one dormant flag** (`SCAN_LIVE_SWEEP_ENABLED`), de-risked by a live sibling precedent (Screener Live Tier) |
| 4 | On-demand "Run Now" | **Scheduling — solved and shipped**, backend and frontend |
| 5 | True sub-daily timeframes at universe breadth | **Data-pipeline limitation — real, and the dominant remaining blocker** (no forming-bar builder for intraday exists in the live path) |
| 6 | Fundamentals/pattern/flow-referencing scalars | **Data-pipeline limitation, permanent by current design** |

RISK-003 (§13) remains the gate on any conversation about arming bucket 3. RISK-017 (§7/§9) is the concrete
latent gap this mapping surfaced: the on-demand door has no backend refusal for an intraday `tf`, currently
safe only by UI omission.

---

## 11. TEST-CREDIBILITY FINDINGS

Full detail: `TEST_CREDIBILITY_FINDINGS.md` (P5). **Lead finding**: dual-kernel agreement and most golden
fixtures prove self-consistency, not vendor parity (RISK-018, §6). This suite's craftsmanship is otherwise
genuinely high — real independent oracles with discriminating controls exist wherever the suite has
assertions at all (`test_screener_technicals_accuracy.py`, `vendor_spec_probes.py`,
`test_signature_*.py`), zero instances found of a test mocking away the thing it claims to verify, and
unusually disciplined skip/xfail hygiene (every instance carries a specific, checkable reason). **The
dominant real risk is missing dimensions, not weak checks on existing dimensions** — illustrated most
sharply by the Group 1-4 pattern-engine sweep (RISK-021), which found four real defects the day before this
audit using a rigorous, control-guarded battery that had simply never asked those particular questions
before. A specific, confirmed regression gap (RISK-022) exists between what browser testing already found
broken (RISK-012/013) and what the backend suite guards against.

---

## 12. TELEMETRY/OBSERVABILITY FINDINGS

Full detail: `TELEMETRY_OBSERVABILITY_FINDINGS.md` (P6). Telemetry as the master prompt defines it (§37's
5-event minimum) **does not exist** for this product surface — `import_submitted`/`import_accepted`/
`delivery_configured` don't exist at all; `compile_finished`/`execution_finished` exist only partially and
one-sidedly (the nightly sweep logs well; the interactive path logs almost nothing). Zero frontend analytics
of any kind. Sentry is present but structurally blind to this feature's dominant failure shape (deliberately
-caught, by-design `HTTPException`s, not crashes). **The most actionable finding**: two already-live,
already-tested storage precedents (`landing_events`, `signature/ledger.py`'s coverage-receipt pattern)
between them could plausibly cover the full 5-event minimum's storage needs without new infrastructure
design (RISK-023).

---

## 13. PRODUCTION-VERIFICATION STATE

**Nothing in this entire packet has been verified against live production, with one narrow exception.**
RISK-003 (scan-hits staleness) was investigated safely and non-destructively against real Railway
infrastructure: confirmed live that `SCAN_SWEEP_ENABLED=1` and the pod is alive and actively logging;
**could not confirm the nightly sweep has actually executed successfully** — four independent read-only log
searches across four time windows all returned zero matches, and a control search against an unrelated
known-daily job was only partially conclusive, suggesting the Railway CLI's historical log search may not
reliably surface everything a naive multi-day window implies. **Classified PRODUCTION-UNVERIFIED, not fixed
and not broken.** Evidence that would resolve it, not attempted this wave: a direct read-only DB query of
`scan_hits`/`scan_coverage`'s most recent `as_of` via Railway SSH, or a live (not historical) `railway logs`
watch through an actual 5:00 AM ET sweep window. Everything else in this packet — all five Golden Journeys,
the data/execution mapping, the test-credibility and telemetry audits, the preservation baseline — is
local/sandboxed or source-code evidence, explicitly not production-verified, and none of it should be read
as if it were.

---

## 14. RISKS

Full register: `RISK_REGISTER.md` (25 entries plus one general standing principle). Grouped by theme:

**Translation-layer / vendor-parity**: RISK-004 (blind-corpus floor, narrowed), RISK-005 (uncovered
scalar), RISK-009 (TC2000 adversarial-corpus unknown), **RISK-018 (central vendor-parity gap)**, RISK-019/
020 (two historical incidents, now fixed).

**Screener/scan**: RISK-003 (PRODUCTION-UNVERIFIED), RISK-017 (on-demand intraday gap), RISK-024 (unwired
prune), RISK-025 (dangling alert refs).

**Frontend/Builder**: RISK-011 (browser-automation-only hang pattern, tooling not product), RISK-012
(double-save), RISK-013 (input fidelity), RISK-016 (shared bars-cap bug), RISK-022 (no regression coverage
for RISK-012/013).

**Pattern engine**: RISK-021 (narrative fabrication, fixed for 8/~100).

**Telemetry**: RISK-023 (near-total absence on the interactive path).

**Naming/dead code**: RISK-001 (Confluence collision), RISK-002 (`dpc-v1` unreachable).

**Documentation**: RISK-007, RISK-015 (specific instances), plus the **general Stale Documentation
Principle** (now observed four times across this one investigation — recorded as a standing lesson, not a
fix-now item).

**Process/tooling**: RISK-006 (unconfirmed concurrent worktree session), RISK-008 (unlanded fix in an
unrelated worktree), RISK-010 (browser verification gap — now substantially closed by this wave), RISK-014
(browser-automation instability, confirmed benign — `screenshot` proven correct every time it disagreed with
`get_page_text`).

No risk in this register was fixed in Phase Zero beyond what the authorization allows (small, obviously-
low-risk, independently-testable, non-disruptive) — none of the above qualified, and none were attempted.

---

## 15. ARCHITECTURAL DECISIONS NOW CLOSED BY EVIDENCE

- **DEC-001 and DEC-002 both hold**, with no contrary evidence surfaced this wave. If anything, the shipped
  architecture exceeds what DEC-001 assumed (Phase E's mechanism, the on-demand scan door, the Screener Live
  Tier).
- **"One grammar, many surfaces" is a shipped fact, not an open research question** — confirmed live across
  three languages converging on the identical canonical AST and the identical screener gate.
- **The numeric-vs-boolean screener gate is a door-agnostic output-type rule**, not a per-language special
  case — directly confirmed, not inferred, via three different source languages hitting it identically.
- **Nightly-only scanning is confirmed product policy, already decided** (§10 bucket 2), not an open
  architectural question — a future reader should not re-litigate this without new evidence.
- **"Raw source text is never persisted" is a deliberate, consistently-implemented boundary**, directly
  protecting DEC-002's no-standalone-scripting-language decision — confirmed across all three import doors
  investigated this wave.
- **The "refusal is 200/ok:false, not a raw 4xx" contract is real and is followed in most places** — and
  where it is *not* followed (RISK-016's bars-cap check), that is itself now a named, precise defect rather
  than an ambiguous architectural question.

---

## 16. ARCHITECTURAL DECISIONS THAT REMAIN OPEN

- **Confluence naming/wiring** (RISK-001, RISK-002) — rename one, cross-link, or leave as-is; whether to
  finish wiring `dpc-v1` or formally retire it.
- **Toolkit commercial tiering** (§8.4, `entitlements.py`'s own docstring calls this explicitly open).
- **Whether/how to auto-detect adjustable Pine inputs** (RISK-013) — a real product design question, not a
  bug fix.
- **When and how to populate `tests/fixtures/vendor/observations/`** (RISK-018) — infrastructure is ready;
  who captures the observations and on what cadence is unresolved.
- **Whether to arm `SCAN_LIVE_SWEEP_ENABLED`** — gated on RISK-003 resolving first; not a live decision yet.
- **On-demand intraday design** (RISK-017) — add the same gate live-mode has, or design a distinct
  on-demand intraday contract, before the frontend dropdown is ever widened.
- **`patterns-retire` worktree's unlanded fix** (RISK-008) — not this program's worktree to act in; needs
  owner routing.
- **CLAUDE.md correction timing** (RISK-015) — small and mechanical; whether to do it now or as part of a
  broader doc-hygiene pass is a scheduling choice, not a technical one.

---

## 17. WHAT SHOULD DEFINITELY BE PRESERVED

- The one-canonical-AST, five-door architecture and its single write path.
- The manifest-driven anti-drift mechanism (AST-walked vocabulary tests forbidding hand-copied strings).
- The dual-kernel conformance check (real engineering value, correctly scoped as self-consistency, not
  vendor parity, once RISK-018's caveat is attached everywhere it belongs).
- The door-agnostic numeric-vs-boolean screener gate and its underlying `<tree> != 0` rule.
- The Honest-None disclosure pattern (a refused/never-swept definition says so specifically, never a bare
  silent zero) — tested, and now confirmed live across three doors.
- The "refusal is 200/ok:false" contract, everywhere it is actually followed.
- The deliberate "raw source is transient, never persisted" boundary protecting DEC-002.
- The soft-delete/tombstone-with-resurrect model for definitions.
- `sentence_for`'s deterministic, AST-derived read-back guarantee, reused correctly across the plain-
  language and screenshot doors alike.
- The `scan_store.prune()`/coverage-receipt design philosophy ("ships with the tables, not after them") —
  the philosophy is sound even where its own instance (RISK-024) wasn't wired.

---

## 18. WHAT MAY NEED TO BE IMPROVED

Small-to-medium, well-scoped, not attempted in Phase Zero per its own authorization:

- Fix RISK-016 (shared bars-cap bug, both AI doors) — likely the single most member-visible bug found this
  wave, since it silently breaks a common-case interaction (a long-history symbol) with a misleading error.
- Fix RISK-012 (double-save debounce/disable) and add regression coverage for it and RISK-013 (RISK-022).
- Wire `scan_store.prune()` (RISK-024) and add an existence/tombstone check to the alert-firing loop
  (RISK-025).
- Add minimal structured logging to the interactive save/import/translate path, and wire it into the
  already-live `landing_events`/`ledger.py` precedents (RISK-023).
- Extend the Group 1-4 pattern-engine narrative/geometry/liquidity sweep to the remaining ~90+ detectors
  (RISK-021).
- Correct CLAUDE.md's two stale references (RISK-015) — small, mechanical, zero code risk.
- Add the on-demand intraday-tf gate mirroring live mode's (RISK-017), independent of any product decision
  to actually widen the frontend dropdown.

---

## 19. WHAT MAY EVENTUALLY NEED REPLACEMENT

**Honest answer: nothing found this wave rises to that bar.** No evidence surfaced in Phase Zero — across
five live Golden Journeys, a full data/execution map, a test-credibility audit, and a telemetry audit —
that any core architectural component (the canonical AST, the dual-kernel execution model, the manifest-
driven static analysis, the screener's nightly-sweep design, the door-agnostic scannability gate) is
structurally wrong or needs replacing. The real findings this wave are gaps (missing telemetry, missing
vendor observations, an unwired prune function, an unwired existence check) and localized bugs (a shared
bars cap, a double-save race), not architectural unsoundness. The two closest candidates for "eventually,"
neither urgent:

- `confluence.py`'s `dpc-v1` prototype may warrant formal retirement if nobody ever wires it (RISK-002) —
  a small, contained deletion, not a replacement of anything load-bearing.
- Hand-maintained design docs (the pattern this program's own Stale Documentation Principle names) may
  eventually be worth replacing with generated documentation for anything that must stay current — a
  process/tooling change, not a product-architecture one.

---

## 20. PROPOSED NEXT PHASE

Grounded in what was actually found this wave, ranked by leverage-to-cost:

1. **Resolve RISK-003 properly** — a real production DB read or a live overnight sweep-window watch. Gates
   any future conversation about arming live-mode scanning.
2. **Populate `tests/fixtures/vendor/observations/`** (RISK-018) — the harness's own specified minimum
   ("three observations, one per shape"). Highest-leverage single item this program has found: turns every
   future benchmark quote from a hope into a measurement.
3. **Fix RISK-016** (shared bars-cap bug) — small, well-scoped, likely the most member-visible defect found.
4. **Wire minimal telemetry** per RISK-023's recommendations — reusing existing storage, not designing new.
5. **Small fixes**: RISK-012 debounce + regression tests (RISK-022), RISK-024 prune scheduling, RISK-025
   existence check, RISK-015 CLAUDE.md correction.
6. **Extend the Group 1-4 pattern-engine sweep** to the remaining ~90+ detectors (RISK-021) — proven method,
   unproven scope.
7. **Route the open owner decisions** (§16, §21) before any further build work depends on their outcome.

None of this was built in Phase Zero, per its own authorization; this is a proposed prioritization for
whoever picks up Phase One, not a commitment made on the owner's behalf.

---

## 21. QUESTIONS REQUIRING OWNER/CHATGPT REVIEW

1. **Confluence**: rename `dpc-v1`, cross-link the two modules' docstrings, or leave as-is? Finish wiring
   `dpc-v1`'s scan-shaped follow-up, or formally retire it?
2. **Toolkit tiering/pricing** (§8.4) — still explicitly open per the code's own docstring; a genuine
   product/business decision, not a technical one.
3. **Pine input-parameter fidelity** (RISK-013) — should the product auto-detect which Pine `input()`
   declarations become adjustable UCT inputs, and by what rule? A real design question, not resolved by
   Phase Zero.
4. **Vendor-observation population** (RISK-018) — who captures the three-per-shape minimum, on what
   cadence, and should this become a standing practice (e.g., one new observation per newly-supported
   function) rather than a one-time backfill?
5. **Should a scoped, Phase-Zero-only Anthropic API key be provisioned** to unblock a genuine live
   verification of the plain-language and screenshot doors' model-call path, given both were ENVIRONMENT-
   BLOCKED this wave for a reason that has nothing to do with product correctness?
6. **`patterns-retire` worktree's unlanded fix** (RISK-008) — whose worktree is this, and should the fix be
   landed?
7. **Is a session currently active in `indicator-endzone`** (RISK-006)? Unresolved since wave one.
8. **CLAUDE.md correction** (RISK-015) — fix now (small, mechanical, safe) or fold into a later, broader
   doc-hygiene pass? Same question for the general Stale Documentation Principle's "consider generated
   documentation" recommendation — worth a dedicated later-phase investigation, or not a priority?
9. **When to arm `SCAN_LIVE_SWEEP_ENABLED`**, once RISK-003 resolves — the Screener Live Tier precedent
   de-risks the underlying mechanism, but not the AST engine's additional complexity (cadence-ceiling
   honesty guard, four-outcome coverage accounting), which has never run live even once.
10. **On-demand intraday** (RISK-017) — does the product ever intend to widen the `RUN_TFS` dropdown past
    D/W/M? If yes, the backend gate needs to exist first; if no, this can stay a documented, accepted latent
    gap rather than a fix candidate.
