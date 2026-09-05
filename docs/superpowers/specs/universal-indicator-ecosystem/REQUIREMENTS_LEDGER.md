# Requirements Ledger — Universal Custom Indicator + Screener Ecosystem

Source: `00-MASTER-PROMPT.md` (master prompt §0–94, addendum items 1–22 + final instruction),
reconciled per `DECISIONS.md` (DEC-001, DEC-002). One row per numbered source item; purely
prohibitive/"do not X" items live in `CONSTRAINT_LEDGER.md` instead (cross-referenced here where a
requirement depends on one). Every row starts at status "not started" unless work is already
demonstrably underway this session — see `PROGRESS.md` for the live dispatch list.

Priority key: **MUST** (non-negotiable given current evidence) · **SHOULD** (real but not blocking) ·
**RESEARCH** (investigate before deciding) · **HYPOTHESIS** (explicitly unproven, per master prompt's
own framing) · **FUTURE** (out of near-term scope) · **NON-GOAL** (explicitly out of scope).

## Master prompt

| ID | Requirement | Category | Priority | Evidence needed | Repo areas | Dependencies | Status |
|---|---|---|---|---|---|---|---|
| MP-000 | Any proposal to replace existing infra must clear the 10-point justification bar | process-organization | MUST | See CL-001 | cross-cutting | — | not started |
| MP-001/2 | Product vision: converge all logic sources into one trustworthy execution system; full BRING→REUSE lifecycle | UX-product | MUST (north star) | Satisfied transitively by later rows | cross-cutting | — | ongoing |
| MP-003 | Produce a Current Ecosystem Preservation Contract (behavior/deps/ownership/coverage/impact/touch-risk/rollback per system) | discovery | MUST | PRESERVATION_CONTRACT.md with per-system entries | uct-dashboard + uct-intelligence | MP-088 | not started |
| MP-004 | Capture behavioral baseline goldens (input→output) for representative existing workflows before core changes | testing-validation | MUST | Golden fixtures checked in | uct-dashboard tests/ | MP-003 | not started |
| MP-005 | Separate user contract from internal implementation; correct flawed behavior only if demonstrable+documented+compat-safe+tested | architecture | SHOULD | See CL-012 | cross-cutting | — | not started |
| MP-006 | Execute Phase Zero discovery before any broad build; small probes OK, broad rewrite not OK | discovery | MUST | Discovery packet sections land with real evidence | cross-cutting | — | **in progress** |
| MP-007 | Reproduce/audit the 4 cited benchmark numbers (38/38, 43/58, 21/48, 28/48); denominators, classification, fixtures | testing-validation | MUST | `BENCHMARK_REPRODUCTION.md` | `app/src/components/chart/engine/ast/{doorScorecard,pine.corpus,pine.blindCorpus,pine.screenerCorpus,thinkscript.corpus}.test.js`, `tools/ast_conformance.py` | — | **DONE 2026-09-04.** Actually run, not inferred. 43/58 and 21/48 confirmed live-accurate; 28/48 confirmed FALSE (repo's own test is currently red at 21/48); memory's 17/21 superseded (today: 14/21). Two new real findings surfaced: blind-corpus assisted-edit floor not met, `ast_conformance.py --coverage` shows `base_relation_count` has zero fixture coverage. |
| MP-008 | Require full proof chain (parse→translate→canonicalize→validate→static-analyze→requirements→execute→deliver→verify) before calling something supported | testing-validation | MUST | See CL-009 | compiler/evaluator (TBD) | MP-007 | not started |
| MP-009 | Verify the execution model is actually closed/bounded/deterministic today, not just historically | architecture | MUST | Audit report | compiler/evaluator | — | not started |
| MP-010 | For any canonical-grammar expansion, evaluate decidability/lookback/complexity/memory/type-safety/repaint/scan-cost/abuse/debugging/vendor-semantics/testing-complexity, not just a node-count threshold | architecture | SHOULD | Applies only when a grammar expansion is proposed | compiler/IR | MP-009 | not started |
| MP-011 | Don't reopen arrays/collections without new benchmark/telemetry/use-case evidence | architecture | RESEARCH | Lightly re-verify the prior "delta of zero" claim | unknown | — | not started |
| MP-012 | Investigate multi-frontend→canonical-IR→...→adapters as the target shape, OR evolve existing architecture if it already approximates this | architecture | RESEARCH/HYPOTHESIS | Architecture comparison doc | compiler/IR + 7/31 doc's definition model | MP-006 | not started |
| MP-013 | Preserve source-map/provenance end to end so errors cite source lines, not IR node IDs | architecture, UX-product | SHOULD | Error messages cite source location | compiler (TBD) | MP-012 | not started |
| MP-014A | Door A — Pine Script: full semantic translation coverage audit (versions/syntax/vars/ops/builtins/series/state/timeframes/sessions/plots/alerts/repaint/unsupported/strategy-vs-indicator/scanner-limits) | architecture | MUST | Capability matrix for Pine | Pine translator (TBD — active work exists) | MP-008 | **in progress** |
| MP-014B | Door B — thinkScript: same coverage audit | architecture | MUST | Capability matrix for thinkScript | thinkScript translator (TBD — active work exists) | MP-008 | **in progress** |
| MP-014C | Door C — TC2000/PCF: same coverage audit | architecture | MUST | Capability matrix for TC2000 | `app/src/components/chart/engine/ast/pcf.js` (`parsePcf`) + `tests/fixtures/ast/pcf_corpus.json` | MP-008 | **CORRECTED TWICE 2026-09-04:** not greenfield (1st correction); `BENCHMARK_REPRODUCTION.md` measured 57/57 translate · 21 ruled · 0 OPEN on its own corpus — plausibly the strongest of the 3 doors by this metric (2nd correction). Caveat: unknown whether PCF has a blind/adversarial corpus analogous to Pine's — flag for a Door C follow-up before trusting 57/57 as representative. Full proof chain (CL-009) still not done. |
| MP-014D | Door D — Plain language: NL→intent→structured-candidate→ambiguity-detect→canonical-compile→deterministic-validate→explanation→execute; AI proposes, never final authority | architecture, UX-product | SHOULD (Phase 6 per prompt's own ordering) | Working pipeline + ambiguity-handling demo | unknown | MP-008 | not started |
| MP-014E | Door E — Screenshot: image→features→plot-ID→params→candidate-logic→confidence→canonical→visual/numeric comparison; expose EXACT/VERIFIED/HIGH-CONFIDENCE/APPROXIMATE/INSUFFICIENT classes; never imply source-code exposure | architecture, UX-product | SHOULD (Phase 6) | Working pipeline + classification demo | unknown | MP-008 | not started |
| MP-015 | Evaluate authoring-model options A–G, produce an ADR | architecture | **RESEARCH/HYPOTHESIS** (downgraded, DEC-002) | ADR reasoning against the existing 7/31 definition model | 7/31 doc, Phase D builder | DEC-002 | not started |
| MP-016 | Investigate a portable "one saved logic object" schema (identity/source/compilation/logic/visual/execution/verification/product/history) | architecture | MUST | Compare against 7/31 doc's definition schema v1 — likely largely satisfied already, verify don't reinvent | 7/31 doc §3 | MP-012 | not started |
| MP-017 | Numeric outputs first-class everywhere (column/sort/threshold/range/compare/cross/save/chart/alert); never misclassified as failed screens | architecture, UX-product | MUST | E2E-verified numeric workflow | screener + indicator engine (TBD) | MP-016 | not started |
| MP-018 | Separate calculation/timeframe/bar-state/session/universe/datasets/run-policy as independent axes | architecture | MUST | Current schema audited against these 6 axes | 7/31 doc §4 (compute contract) | MP-016 | not started |
| MP-019 | Compute an execution-requirement contract per artifact; refuse clearly on lane mismatch, never silently substitute | architecture, security | MUST | Tested refusal path for a lane-mismatch case | execution kernel (TBD) | MP-018 | not started |
| MP-020 | Evaluate bounded intraday/Run-Now against real data-infra cost before building | data | RESEARCH | Cost/feasibility memo | uct-intelligence data providers + Railway | MP-025 | not started |
| MP-021 | Produce `TECH_STACK_RFC.md` per layer (current/strengths/weaknesses/candidates/benchmarks/migration-cost/ops-complexity/maintainability/perf/security/lock-in/recommendation) | architecture, documentation | SHOULD | File exists in MP-090 format | cross-cutting | most archaeology rows | not started |
| MP-022 | Evaluate parser/compiler tech separately for compiler-backend vs editor-syntax-intelligence; don't rewrite a working parser without evidence | architecture | RESEARCH | Recommendation table (MP-090 format) | existing Pine/TS parser (TBD) | MP-014A/B | not started |
| MP-023 | Evaluate a real authoring/editor environment; design mobile responsive behavior separately, don't assume desktop-editor architecture ports | architecture, UX-product | SHOULD | — | uct-dashboard frontend (TBD — does an editor exist today?) | MP-015 | not started |
| MP-024 | Audit the existing evaluator (execution language/vectorization/caching/batching/memory/dispatch/NaN-handling/lookback-buffers/scale perf); only evaluate native/Rust/WASM/JIT alternatives with benchmark justification | architecture, data | MUST (audit) / RESEARCH (alternatives) | Audit report + benchmarks | evaluator (TBD) | MP-006 | not started |
| MP-025 | Audit existing data ecosystem before proposing another provider; create one canonical market-data contract if none exists | data | MUST | Data-provider map | uct-intelligence (Massive.com etc.) | — | not started |
| MP-026 | Audit job orchestration (cron/queues/retries/idempotency/crash-recovery/concurrency); only evaluate durable workflow tech if current infra can't answer the crash/resume/duplicate/deploy questions | architecture | MUST (audit) / RESEARCH (alternatives) | Orchestration audit answering the crash-at-symbol-2400 scenario | uct-dashboard APScheduler + uct-intelligence Task Scheduler | — | not started |
| MP-027 | Determine whether existing observability supports a full request→...→deliver trace with a stable run ID; evaluate a vendor-neutral standard if not | telemetry | SHOULD | — | unknown | — | not started |
| MP-028 | Evaluate testing technology (unit/property/fuzz/mutation/E2E/visual/perf/load/contract/vendor-differential/smoke) consistent with repo languages | testing-validation | MUST | Current test-stack inventory + gaps | uct-dashboard tests/, app/*.test.jsx, uct-intelligence tests | — | not started |
| MP-029 | Create generative/property-based tests for the compiler/formula engine (round-trip, normalization equivalence, lookback invariants, valid-AST, equivalent-rewrites, scanner/chart parity, determinism, resource bounds) | testing-validation | SHOULD | — | compiler (TBD) | MP-028 | not started |
| MP-030 | Investigate metamorphic-testing relationships where no oracle exists; each property reviewed, not assumed | testing-validation | RESEARCH | — | compiler/evaluator | MP-029 | not started |
| MP-031 | Build differential vendor testing with deterministic fixtures (vendor/version/date/script/params/tf/session/symbol/outputs/tolerance/result) | testing-validation | MUST | Fixture store exists and is used | TBD — dispatched agent investigating | MP-014A/B | **in progress** |
| MP-032 | Establish a Vendor Oracle Protocol for ambiguous functions (minimal diverging input→real vendor run→raw evidence→classification→permanent fixture) | testing-validation | MUST | Protocol doc + worked example | same as MP-031 | MP-031 | not started — NOTE: recent commits ("ruling(bbw/percentrank/median): three names researched, three refused") suggest an informal version may already exist; verify before designing fresh |
| MP-033 | Track compatibility on 9 independent dimensions with the 9-class status vocabulary, not one boolean | testing-validation | MUST | `CAPABILITY_MATRIX.md` uses this schema | cross-cutting | MP-008 | not started |
| MP-034 | Silent wrong answer always outranks correct refusal in severity | see CL-004 | — | — | — | — | — |
| MP-035 | Maintain 4 benchmark tiers (product-critical / broad-net / frozen-blind-exam / real-member-corpus) | testing-validation | SHOULD | — | TBD — compare against existing 38/38 etc. corpora | MP-007 | not started |
| MP-036 | Define outcome-level "blind member task success" distinct from translator success; track the 7 named outcomes; denominator immutable post-hoc | testing-validation | MUST | See also CL-018 | same as MP-035 | MP-035 | not started |
| MP-037 | Instrument the 5 named telemetry events with their specified fields before intuition-driven prioritization | telemetry | MUST | Events firing in prod | uct-dashboard telemetry infra (TBD — general product telemetry not confirmed to exist) | MP-027 | not started |
| MP-038 | Build product funnel analysis/dashboards answering the 15 named questions | telemetry | SHOULD | — | same as MP-037 | MP-037 | not started |
| MP-039 | A product designer participates throughout, not backend-then-handoff | process-organization | MUST | — | n/a (staffing) | — | not started |
| MP-040 | Design the 6-step import flow; keep advanced complexity available without intimidating the basic flow | UX-product | SHOULD | — | uct-dashboard frontend (TBD — existing import UI?) | MP-039 | not started |
| MP-041 | Expose original vs. UCT-interpretation; explain understood/inferred/changed/unsupported with actionable reasons | UX-product | MUST | — | same as MP-040 | MP-042 | not started |
| MP-042 | Build the 13-code structured error taxonomy, each with code/explanation/source-range/recoverability/action/debug-context | architecture, UX-product | MUST | — | compiler + frontend error surfaces | MP-013 | not started |
| MP-043 | Expose VERIFIED/SUPPORTED/INFERRED/PARTIAL/UNSUPPORTED labels without overwhelming normal users | UX-product | MUST | — | frontend | MP-033 | not started |
| MP-044 | Support beginner and advanced users via progressive disclosure | UX-product | MUST | — | frontend | MP-040 | not started |
| MP-045 | Reuse UCT's existing design system rather than an app-within-an-app | UX-product | MUST | — | uct-dashboard component library / tokens.css | — | not started |
| MP-046 | Run full clickable-surface E2E/browser QA after each major milestone; API-responds ≠ frontend-done | testing-validation | MUST | — | uct-dashboard frontend | implementation milestones | not started |
| MP-047 | Cross-browser test major workflows (Chromium/WebKit/Firefox + mobile/responsive) | testing-validation | SHOULD | — | same | MP-046 | not started |
| MP-048 | Consider visual regression tests for high-value stable surfaces | testing-validation | SHOULD | — | same | MP-046 | not started |
| MP-049 | Measure before optimizing: benchmark the 13 named dimensions, set budgets after baseline | testing-validation | MUST | — | TBD | MP-024 | not started |
| MP-050 | Investigate scan-engine optimization only with benchmark justification | architecture | RESEARCH | — | screener engine (6/19 doc already covers some via nightly snapshot DB) | MP-049 | not started |
| MP-051 | Threat-model all 5 doors (parser bombs, injection, XSS, DoS, cross-user access, artifact permissions, alert abuse, runaway compute) | security | MUST | — | cross-cutting | MP-014A–E | not started |
| MP-052 | Version every layer (dialect/parser/translator/IR/semantic-lib/compiler/kernel/schema); never silently change saved semantics | architecture | MUST | 7/31 schema already has version+compute.rev — verify it covers all axes | 7/31 doc §3.1 | MP-016 | not started |
| MP-053 | Every migration defines old/new state, migration, verification, rollback, user impact, failure mode | process-organization | MUST | — | n/a (process) | — | not started |
| MP-054 | Shadow mode for significant execution-engine changes before cutover | architecture, testing-validation | MUST | — | 7/31 doc's Flip A/B strategy is a live precedent | — | not started |
| MP-055 | New functionality isolatable via the existing feature-flag mechanism, staged rollout ladder | process-organization | MUST | Confirm which mechanism is "the existing one" (memory references a flag ledger/audit tool) | uct-dashboard (TBD) | — | not started |
| MP-056 | Investigate canary/staged release for risky backend changes | process-organization | SHOULD | — | Railway deployment infra | MP-055 | not started |
| MP-057 | No big-bang migration; incremental coexistence, strategy determined from repo reality | architecture | MUST | — | cross-cutting | MP-054 | not started |
| MP-058 | Every major phase needs a credible rollback answer | process-organization | MUST | — | n/a (process) | — | not started |
| MP-059 | Maintain one Project Lead/Chief Integrator; no specialist unilaterally changes strategic direction | process-organization | MUST | — | n/a (role) | — | **ongoing** (Claude fills this role) |
| MP-060 | Create/simulate the named specialist workstreams as evidence shows they help | process-organization | SHOULD | — | n/a | — | **in progress** (2 dispatched) |
| MP-061 | Parallelize independent research; no uncoordinated edits to the same compiler core; every report uses the 8-field format | process-organization | MUST | — | n/a | — | **ongoing** |
| MP-062 | Assign a challenger agent to important architectural recommendations | process-organization | SHOULD | — | n/a | — | not started (no recommendation has reached this stage yet) |
| MP-063 | Marketing specialist investigates migration/positioning but never decides technical truth; no unsupported "fully compatible" claims | process-organization, documentation | SHOULD | — | n/a | — | not started |
| MP-064 | Research actual competitor workflows (not feature lists) for the named products | discovery | SHOULD | — | external research | — | not started |
| MP-065 | Build competitive-replacement migration scenarios per user type | discovery, UX-product | SHOULD | — | external research | MP-064 | not started |
| MP-066 | Plan documentation derived from the same capability metadata the engine uses, to avoid drift | documentation | SHOULD | Confirmed 2026-09-04 | `app/src/components/chart/engine/ast/{closedTable.json,vocabulary.js}` → `app/src/pages/formulas/FormulaReference.jsx` (`/formulas/reference`); same manifest also feeds `api/services/definition_concierge.py`'s AI tool schema | MP-033 | **already satisfied for the Pine/thinkScript/PCF door — predates this program; no new work needed here** |
| MP-067 | Consider an editable template library (12 named example indicators) | UX-product | FUTURE | — | TBD | MP-016 | not started |
| MP-068 | Investigate debugger/explainability (expression values, bar-by-bar, why-matched/failed, trace) | UX-product, architecture | SHOULD | — | TBD | MP-013 | not started |
| MP-069 | Consider standardized "explain match" per-condition trace output; evaluate perf cost | UX-product | SHOULD | — | TBD | MP-068 | not started |
| MP-070 | Data provenance identifiable for debugging/support (symbol/venue/provider/timestamp/adjustment/session/tf/freshness) | data, testing-validation | MUST | — | uct-intelligence data layer | MP-025 | not started |
| MP-071 | Establish a Parity Incident Protocol with the 7-class classification; every confirmed bug gets a permanent regression test | testing-validation | MUST | — | same as MP-031/032 | MP-032 | not started |
| MP-072 | Operationalize release quality as zero-critical + zero-silent-wrong-answer, not vague "100%" | see CL-005 | — | — | — | — | — |
| MP-073 | Adopt S0–S4 bug severity; no known S0/S1 before broad release | testing-validation | MUST | — | n/a (process) | — | not started |
| MP-074 | Standard bug workflow (reproduce→minimize→failing-test→root-cause→fix→verify→regression→check-bug-class-elsewhere) | process-organization | MUST | — | n/a | — | not started |
| MP-075 | Require explicit evidence across the 14 named readiness dimensions before broad release | process-organization, testing-validation | MUST | — | n/a | — | not started |
| MP-076 | Create persistent repo documentation so knowledge doesn't live only in the Claude context window | documentation, process-organization | MUST | — | this folder | — | **in progress** (this ledger + 00-MASTER-PROMPT.md + DECISIONS.md + PROGRESS.md) |
| MP-077 | Every major decision gets a Decision Record in the specified 10-field format | documentation, process-organization | MUST | — | `DECISIONS.md` | — | **ongoing** |
| MP-078 | Maintain an active Risk Register (16 named risk categories, each with likelihood/severity/detection/mitigation/owner) | process-organization | MUST | `RISK_REGISTER.md` does not exist yet — gap | this folder | — | not started |
| MP-079 | Treat Phase 0–7 as provisional; let discovery determine actual sequencing | process-organization | SHOULD | — | n/a | — | not started |
| MP-080 | Every phase needs the 9-field exit-criteria format; merged code ≠ complete | process-organization | MUST | — | n/a | — | not started |
| MP-081 | Produce a compact ChatGPT Review Packet at important checkpoints | documentation, process-organization | MUST | — | n/a | — | not started — first one due once wave-one agents return |
| MP-082 | Stop for owner review before the 10 named irreversible/high-impact actions | see CL-006 | — | — | — | — | — |
| MP-083 | Never ask the owner something repo inspection can answer | see CL-007 | — | — | — | — | — |
| MP-084 | Surface genuine repo-unanswerable product decisions as real owner decisions | process-organization | MUST | — | n/a | — | **ongoing** (Bucket-C mechanism already in use — see the Phase-Zero authorization exchange) |
| MP-085/6/7 | Definition of success / competitive standard / north star — used as the evaluation lens for every other requirement | UX-product | MUST (lens, not deliverable) | — | cross-cutting | — | ongoing |
| MP-088 | Execute the 15-step Phase Zero discovery list | discovery | MUST | — | cross-cutting | — | **in progress** |
| MP-089 | Produce the full A–Z Discovery Packet | documentation | MUST | — | cross-cutting | everything above | not started — target output of Phase Zero, not its first response (see 00-MASTER-PROMPT.md status note) |
| MP-090 | Every tech-stack recommendation uses the 8-column table format | documentation | MUST | — | n/a | — | not started |
| MP-091 | Every build-plan phase uses the 17-field format | documentation | MUST | — | n/a | — | not started |
| MP-092 | Conclude discovery with an explicit "build this first" recommendation | process-organization | MUST | — | n/a | all discovery rows | not started |
| MP-093 | Produce the ChatGPT-copyable review packet in the 15-field format at the end | documentation | MUST | — | n/a | — | not started |
| MP-094 | Final operating principle — optimize for outcome/correctness/reliability/safety/extensibility/perf/ease-of-use/trust, not vanity metrics | process-organization | MUST (lens) | — | cross-cutting | — | ongoing |

## Validation Addendum

| ID | Requirement | Category | Priority | Evidence needed | Repo areas | Dependencies | Status |
|---|---|---|---|---|---|---|---|
| ADD-001 | Treat merged code/passing tests/prior reports/matrices/benchmarks/"done" labels as claims to re-verify, not evidence | see CL-008 | — | — | — | — | — |
| ADD-002 | Human testers are not first-line QA; engineering verification finds Save-doesn't-work-class defects first | testing-validation | MUST | — | n/a (process) | — | not started (far downstream) |
| ADD-003 | Build the 11-level Confidence Ladder; no subsystem skips from Implemented straight to Ready-for-humans | testing-validation | MUST | `CONFIDENCE_LADDER.md` defined and applied per subsystem | this folder | — | not started |
| ADD-004 | Build the Validation Coverage Map; default UNVERIFIED absent executable evidence | testing-validation | MUST | `VALIDATION_COVERAGE_MAP.md` populated from real evidence | cross-cutting | ADD-003 + archaeology findings | **not started — blocked on wave-one archaeology** |
| ADD-005 | Define and verify the 12 named Core Golden User Journeys end to end | testing-validation | MUST | — | cross-cutting | ADD-004 | not started |
| ADD-006 | Test the real frontend via browser automation once exercisable; backend tests alone insufficient | testing-validation | MUST | — | uct-dashboard frontend | MP-046 | not started |
| ADD-007 | Build a clickable-surface inventory before human QA | testing-validation | MUST | — | same as MP-046 | MP-046 | not started |
| ADD-008 | Automated differential checks wherever two paths should agree (chart vs screener, preview vs saved, old vs new engine, UCT vs vendor) | testing-validation | MUST | — | TBD | MP-054 | not started |
| ADD-009 | Deterministic known-answer synthetic bar fixtures across the 12 named conditions | testing-validation | MUST | — | test fixtures (likely new) | — | not started |
| ADD-010 | Validate the 20 named negative paths as aggressively as happy paths | testing-validation | MUST | — | cross-cutting | MP-042 | not started |
| ADD-011 | Failure-inject in dev/staging across the 8 named dependency failures | testing-validation | SHOULD | — | TBD | ADD-010 | not started |
| ADD-012 | Verify scan correctness by exact symbol membership, not hit-count; test both false positives and negatives | testing-validation | MUST | — | screener engine | ADD-009 | not started |
| ADD-013 | Shadow existing screener behavior wherever touched; classify every mismatch, never wave through "unknown" | testing-validation | MUST | — | screener engine | MP-054 | not started |
| ADD-014 | Ask "what would falsify this claim?" for every high-value claim; require stronger-than-unit-test evidence | testing-validation | MUST | — | cross-cutting | — | **ongoing** — already governs how archaeology findings get reported |
| ADD-015 | Produce a Test Credibility Assessment (coverage, assertion meaningfulness, fixture diversity, flaky/disabled tests, mocks hiding failures) | testing-validation | MUST | — | cross-cutting test suites | MP-028 | not started |
| ADD-016 | Build a release-blocking core-workflow suite that runs automatically pre-merge/release | testing-validation | MUST | — | CI config (TBD — exists?) | ADD-005 | not started |
| ADD-017 | Zero known silent semantic wrong-answer defects before broad release | see CL-005 | — | — | — | — | — |
| ADD-018 | Observability resolves "this scan seems wrong" to the 10 named context fields without days of archaeology | telemetry | MUST | — | same as MP-027 | MP-027 | not started |
| ADD-019 | Produce a Human Testing Readiness Report with an explicit NOT-READY/LIMITED/BROAD recommendation | process-organization, testing-validation | MUST | — | n/a | everything above | not started (far downstream) |
| ADD-020 | Give human testers a purposeful mission per the 8 named personas | process-organization | SHOULD | — | n/a | ADD-019 | not started |
| ADD-021 | Owner confidence is a required output — evidence, never "everything looks good" | documentation | MUST | — | cross-cutting | — | **ongoing** — the standard this ledger itself is held to |
| ADD-022 | Validate continuously per increment, not as a big-bang pass at the end | process-organization | MUST | — | n/a | — | ongoing (applies once implementation starts) |
| ADD-023 | Hold Capability/Correctness/Reliability as three equally-required release dimensions | process-organization | MUST (lens) | — | cross-cutting | — | ongoing |
| ADD-024 | Classify the current ecosystem as VERIFIED/PARTIALLY-VERIFIED/UNVERIFIED/KNOWN-BROKEN, per subsystem | testing-validation | MUST | Populates the Validation Coverage Map | cross-cutting | ADD-004 + all archaeology | **in progress — literal objective of the dispatched archaeology agents** |

## Notes on extraction

- Rows marked "see CL-xxx" are purely prohibitive/constraint-shaped source items; they live in
  `CONSTRAINT_LEDGER.md` as the authoritative entry and are cross-referenced here only so no source
  section silently disappears from this ledger.
- MP-015 is the one row where DEC-002 overrides the master prompt's own framing (directive → hypothesis).
  No other row required a priority override beyond ordinary judgment calls.
- Several rows (MP-016, MP-052, MP-066, MP-031/032) flag "likely already partially satisfied by the 7/31
  program — verify, don't reinvent." This is a direct consequence of DEC-001 and should shape how the
  archaeology agents' findings get folded back into status updates: confirming "already satisfied" is as
  valid an outcome as finding a gap.
