# ChatGPT Review Packet #2 — Phase One Trust Foundation, Checkpoint

**Worktree:** `C:\Users\Patrick\uct-dashboard\.claude\worktrees\indicator-ecosystem`, branch
`worktree-indicator-ecosystem`, HEAD `cb68bb367` **at packet-generation time** — this file was
itself then committed as `9973fe5bc`, one commit later than the HEAD it names, since a commit
cannot name its own future hash. This note added 2026-09-05 per owner/ChatGPT review (Decision
8 of the Phase Two authorization) so the discrepancy reads as expected provenance, not a
recovery inconsistency; git history is unedited — `cb68bb367` remains the true parent of
`9973fe5bc`.
**Scope:** This packet covers **Phase One** (authorized by `CHATGPT_REVIEW_PACKET_01.md`'s
review and `DECISIONS.md` DEC-003) — Tracks A through F, run to their current checkpoint. It
does not re-derive Packet #1's architecture excavation; that packet's findings stand except
where explicitly corrected below (§7, §11). No tech-stack proposal, no new feature phase, no
implementation beyond what each track's own authorization covered.
**What changed since Packet #1 that this packet exists to report:** a full adversarial
self-audit (`PROJECT_EVIDENCE_ASSUMPTION_AUDIT_01.md`) found and corrected real narrative
drift; Track A obtained real vendor evidence, twice, with the second pass adding an
independently-inspectable raw artifact; Track D resolved a stale production-health risk to
VERIFIED HEALTHY; Track E obtained real, live, credentialed model-call evidence, found and
fixed a genuine semantic-safety defect on the AI door in the process; Track F shipped a
narrow, real feature and made its own headline claim reproducible.

---

## 1. Final Track State (A–F)

| Track | Status | One-line evidence |
|---|---|---|
| **A — Vendor Parity / Semantic Truth** | **Tranche 1A COMPLETE, raw-artifact-backed** | 4 vendor-semantics-only observations, TradingView Premium CSV export, 12 agreeing `phase==24` rows at ~1e-13 precision, raw CSV preserved and cited from every observation's `provenance.rawArtifact` |
| **B — Known Correctness/Reliability Defects** | **DONE (2026-09-04)** | All 7 items fixed and regression-tested |
| **C — Product Telemetry** | **CLOSED (2026-09-04)** | 5-event minimum wired end-to-end, hardened same day per owner review (`EVENT_SCHEMAS`); 58 tests, full sweep 407 passed / 6 expected-skipped |
| **D — Production Scan Truth (RISK-003)** | **RESOLVED — VERIFIED HEALTHY (2026-09-05, third pass)** | `scan_coverage.MAX(as_of)=20260904` across 4 scan definitions, full 3,742-ticker universe, gap-free run; packaged as `tools/track_d_risk003_probe.py` |
| **E — Complete AI-Door Golden Journeys** | **COMPLETE (2026-09-05)** | Real, live, credentialed `claude-opus-5` round trips for both remaining doors; a real semantic-safety defect found on the first live attempt, fixed, confirmed fixed on a second live attempt (7/7 passed) |
| **F — Imported Parameter Contract ADR** | **CLOSED FOR NARROW V1 (2026-09-05)** | `input.int`/`input.float` shipped end-to-end, verified live; RISK-013 PARTIALLY CLOSED (explicitly still open for 7 other input kinds + switch-driving inputs + enums + bar-displacement) |

Track B and C carry no open items from this packet's perspective; A, D, E, and F each carry
disclosed residuals — see §3, §5, §6, and §9.

---

## 2. Track A — Raw TradingView Artifact Evidence

Two passes, same day, both autonomous (Claude Code browser automation against the owner's
already-authenticated TradingView session — no manual owner data entry).

- **Pass 1** ran the approved oracle script (`OWNER_VENDOR_CAPTURE_PACKET_V3_1.md`) against the
  real runtime, but TradingView's CSV export was Premium-gated at the time, so evidence rested
  on a Table-view transcription: 2 agreeing `phase==24` rows, 2-decimal display precision.
  Correctly downgraded by the adversarial audit (§7 below) to "SEMANTIC RULINGS CAPTURED, RAW
  VENDOR ARTIFACT INCOMPLETE."
- **Pass 2**, later the same day, once TradingView Premium removed the CSV paywall: re-ran the
  identical script, exported the real 67KB chart-data CSV (298 trading days), and — per explicit
  instruction not to assume it would match pass 1 — re-derived all four rulings from this fresh,
  full-precision, 12-row artifact as unbiased evidence. **All four came out identical.**

**Findings (`ta.rising`, `ta.median` even-length, `ta.percentrank`, `ta.bbw`), TradingView Pine
v5, web, confirmed across 12 agreeing rows at ~1e-13 precision:**
- `ta.rising(x,3)` → strict monotone over length+1 samples, NOT running-maximum.
- `ta.median(x,4)` (even length) → mean-of-the-two-middles, NOT lower-of-the-two-middles.
- `ta.percentrank(x,4)` → divide by L (current bar not in the sample), NOT L+1.
- `ta.bbw(x,20,2)` → the percent form (×100), NOT the raw ratio.

**Raw artifact:** `tests/fixtures/vendor/raw_captures/2026-09-05-tv_oracle_capture_2026-09-05.csv`,
referenced from every observation's `provenance.rawArtifact`. `vendor_truth.py --check`/
`--coverage`: "0 parity-comparable, 4 vendor-semantics-only" — correct, expected (no UCT
engine implementation exists for any of the four functions yet; this is VENDOR SEMANTICS
CAPTURED, never VENDOR-PARITY VERIFIED). The owner's TradingView account was restored to its
exact pre-capture pixel state both passes.

**Not authorized by this capture:** implementing the four functions, or editing
`closedTable.json`'s `_functions_excluded` ruling text — both explicitly held for this review.
Full evidence trail: `RISK_REGISTER.md` RISK-018/RISK-018a.

---

## 3. Track D — VERIFIED HEALTHY

Two prior passes hit tooling walls (an isolated-worktree fork's blanket `railway ssh`
script-complexity refusal, then a PTY-hang workaround). The third pass ran the identical
prepared probe from the main repo checkout with Railway confirmed linked
(`railway status` → `luminous-recreation`/`production`/`web`) and it worked cleanly.

**Evidence:** `scan_coverage`'s `MAX(as_of)=20260904` across 4 independent scan definitions,
each evaluating the full 3,742-ticker universe, with a gap-free run of prior sessions and
non-zero `scan_hits` through the same date. The probe ran on Saturday 2026-09-05, so Friday
2026-09-04 is the most recent possible trading-session close — `MAX(as_of)` matches exactly.
Packaged for repeatable future spot-checks as `tools/track_d_risk003_probe.py` (tested).

---

## 4. Track E — Real Live-Model Evidence + the Semantic-Safety Defect

A scoped, isolated-environment-only Anthropic dev/test credential (DEC-008 — never
production, never a member's) was provisioned and used for two live runs the same day, then
cleared. This session never had access to the credential value at any point.

### First run: 6 failed, 1 passed

Root cause of all six: a **test-fixture defect**, not a product or model defect.
`test_golden_journey_04_05_live.py`'s `client` fixture built `TestClient(app)` without
entering it as a context manager, so the app's `lifespan` (which initializes every store)
never ran. `catalyst.store`'s schema was never created, so `cost_guard.may_member_spend()` —
called before any Anthropic call, in both AI doors — 500'd on a missing table before a single
real model call could happen. **Confirmed: zero real Anthropic calls occurred for any of the
six failures.** Fixed by explicitly initializing the two stores the real code path needs,
matching an idiom already used elsewhere in the suite.

### The semantic-safety defect found once the fixture was fixed

Re-testing locally with a mocked model (before spending real credential-bearing calls again)
surfaced two **real, independent product defects**, previously unreachable:

| Defect | Prompt | Live behavior found | Root cause |
|---|---|---|---|
| Unsupported named-function silent substitution | `"plot the McGinley Dynamic of the close over 14 bars"` | `ok:true`, silently substituted an EMA tree, no trace of the refused name | `definition_concierge.plan()`'s vocabulary matcher only acts on text it explicitly recognizes; an unrecognized proper name reached the model as ordinary prose |
| Ambiguous-language silent guessing | `"flag it when the vibe turns bullish"` | `ok:true`, invented a formula from whole cloth | Same root cause — nothing flagged the clause as ungrounded before or after the model call |

**Fix — two general, non-blacklist mechanisms** (RISK-026 has full detail):

1. **`_named_phrases()`** — a run of two-or-more proper-noun-shaped words not already grounded
   by an existing match is excised via the pre-existing `not_understood` mechanism, reusing
   `concept_vocabulary.GATE_UNGROUNDED`. **Pure code** — no model input can bypass it; proven
   both by a mock that makes `_call_model` raise if reached, and live (case 4, below).
2. **A new REQUIRED tool-schema field, `unresolved`** — the model must list any phrase it
   could not confidently ground on every answer (empty is an affirmative claim, not silent
   omission). `propose()` refuses, deterministically and without a retry, whenever it is
   non-empty. Proven live (case 3, below).

A first design attempt at mechanism 2 was a **pre-model syntactic check** ("refuse any
clause matching zero vocabulary entries") and was **reverted** after this module's own
pre-existing test suite proved it too broad: `"a twenty bar average of it"` and `"stocks
where that holds"` are both legitimately fully-unanchored and contractually required to
succeed. This course-correction is recorded rather than hidden.

**Disclosed, not closed:** a single-word unsupported proper name (e.g. "Aroon") is not caught
by the two-or-more-word heuristic. The `unresolved` self-report mechanism is a materially
stronger contract than free-text prompting (schema-required, not merely requested) but
remains dependent on the model honestly reporting its own uncertainty — not proof against a
model that confidently mis-reports `unresolved: []`.

### Second run: 7 passed, 0 failed

Every case, including both previously-failing ones, now passing on real evidence:

| Case | Result |
|---|---|
| Empty prompt refuses before spending a token | PASS |
| Positive: `"close above the 50 day moving average"` | PASS — real model call → `close > sma(close,50)`, defensible sma-vs-ema choice |
| Ambiguous: `"the vibe turns bullish"` | PASS — `ok:false`, `gate:model:unresolved` (the model's own honest self-report, fired correctly, live) |
| Out-of-vocab: `"McGinley Dynamic"` | PASS — `ok:false`, `gate:concept:ungrounded`, names the phrase exactly |
| Persistence survives reload with same astHash | PASS — real save → real reload, byte-identical `compute.ast` |
| Saved definition is scan-deliverable | PASS — accepted by the ordinary save door, no AI-door-specific path |
| Screenshot → real vision call → candidates | PASS — RSI(14) of close at confidence 88 (correct), two lower-confidence alternatives honestly labeled (8, 4) |

Real cost/tokens recorded: the vision call alone billed 12,249 input / 870 output tokens,
$0.082995. Full evidence: `GOLDEN_JOURNEY_04_05_LIVE_RESULTS.md` (reviewed by hand, DRAFT
banner removed), `tools/_track_e_runs/golden_journey_04_05_20260905-{145122,164214}.log` +
the second run's `.evidence.json` (local-only, gitignored — the runner never logs the key
value, only its length).

**Scope, stated precisely:** one phrasing per failure class was exercised live; broader
generalization (10 additional novel phrasings, never seen in any fixture) was proven
non-live only, in `tests/test_definition_concierge.py::TestSemanticCoverageGate`.

---

## 5. Track F — Narrow V1 Accepted, and the Reproducible 29-Parameter Count

**Shipped and verified live:** `input.int`/`input.float` end to end — translator support,
`pineParamManifest.js`, `ParamControls.jsx`, BuilderSheet/PineBox integration, server-side
trusted-manifest enforcement. Live browser confirmation: RSI fixture length 14→21,
DB write/reload, out-of-range rejection (reject-not-clamp, confirmed via a 500 against a
declared `maxval=200` that reverted rather than clamped). A same-day follow-up verified the
reopen/re-tune path live (PUT not POST, version increment, immutable default preserved).

**RISK-013 = PARTIALLY CLOSED.** Closed for `input.int`/`input.float`; explicitly still open
for `input.bool`/`string`/`source`/`timeframe`/`symbol`/`time`/`color`, switch-driving
inputs, numeric `options` enums, and bar-displacement cases.

**The corrected 29-parameter claim.** The Track F completion report originally stated
"14/14 corpus scripts gained ≥1 adjustable parameter, 29 total" as a one-time manual count —
unverifiable and, per the adversarial audit's own standard, not trustworthy as stated. A new
permanent regression test, `pine.paramCorpusCount.test.js`, now reproduces this claim from
the actual translator + manifest builder against every `.pine` fixture in
`tests/fixtures/pine/`:

- `translating.length === 14`, `withAtLeastOneParam.length === 14`
- `totalDistinctParams === 29` — **matches the original claim exactly**
- `totalLocatorOccurrences === 1204` — a genuinely different metric (AST locator sites, not
  distinct parameter IDs) that must never be conflated with the "29" figure; discovered while
  reproducing, and deliberately NOT forced to equal 29 to make the numbers agree

The original "29" figure was correct all along — it is now reproducible, not merely
re-asserted.

**No further Track F expansion is authorized without this review.**

---

## 6. Corrected Benchmark Truth — the 21/48 Figure

The master prompt's own claim, "28/48 after assisted edits," is **currently false**, and the
repo's own test is currently RED on this exact claim. Reproduced independently, twice, this
session:

> Reproduced result, independently, twice, in this session (2026-09-05): **21/48** —
> identical to the pre-assisted-edit base rate. The assisted-edit/"offer" mechanism recovers
> **zero** additional blind-corpus scripts.

Repro: `npx vitest run src/components/chart/engine/ast/pine.blindCorpus.test.js`
(`ACCEPTED.length >= 28` fails; `ACCEPTED.length` is actually 21; `PASSING.length >= 21`
passes separately). **28/48 must never be reported as current truth.** Tracked under
RISK-004, unresolved — the assisted-edit uplift is currently zero, and no fix was authorized
or attempted in this packet's scope. Per this program's own append-only documentation rule,
the original "28/48" text in `00-MASTER-PROMPT.md` was left verbatim, annotated with a
correction blockquote immediately beneath it, rather than silently rewritten.

---

## 7. What the Adversarial Audit Corrected (and what has since moved further)

`PROJECT_EVIDENCE_ASSUMPTION_AUDIT_01.md` (15 sections: overall verdict; confirmed/weakened/
disproven claims; stale assumptions; non-real blockers; production drift; test-credibility;
security; DEC-008 recommendation; corrected A–F status; confidence ladder; go/no-go for
Track E and this packet) found and fixed real narrative drift:

- Two AI doors were narrated as "not yet live" while both were already live in production
  for real paying members (`INDICATOR_VISION_ENABLED=1` armed since 2026-09-02;
  `/api/user-definitions/propose` mounted unconditionally). Corrected framing: Track E
  validates already-shipped doors under controlled evidence, not "bringing them into
  existence." (See §4 — now moot in the sense that real live evidence exists either way.)
- DEC-008 was narratively framed as "no Anthropic credential exists" when the accurate
  framing was "a production credential exists; Track E's own governance deliberately
  requires a separate, scoped one for hygiene" (DEC-012). This was resolved in practice:
  the owner provisioned exactly such a credential, used it per the approved policy, and it
  was cleared afterward.
- The 28/48 and 29-parameter claims (§5, §6 above) were the two unreproducible benchmark
  figures the audit flagged; both are now either corrected or made reproducible.
- Track A's raw-artifact gap (§2) was the audit's one open evidentiary finding; it has since
  been closed by the second capture pass.

**Audit §11's per-track verdicts are now superseded in two places**, both improvements: Track
A moved from "closed, credible, not independently corroborated" to raw-artifact-backed; Track
E moved from "blocked pending an owner decision" to complete with live evidence. Nothing in
the audit's findings has been contradicted — only advanced.

---

## 8. Validation Coverage Map (current snapshot)

Full detail in `VALIDATION_COVERAGE_MAP.md`; ladder is 0 Exists · 1 Unit · 2 Integration ·
3 Semantic · 4 End-to-End · 5 Adversarial · 6 Regression · 7 Performance/Scale ·
8 Staging/Prod-like · 9 Human · 10 Controlled Release. Selected rows most relevant to this
packet:

| Subsystem | Level | Note |
|---|---|---|
| Pine/thinkScript/TC2000 → canonical AST (one fixture each) | 4 — End-to-End | Packet #1's Journeys #1–3, unchanged this packet |
| **Plain-language (AI concierge) door** | **4 — End-to-End** (moved this packet) | Real model round trip, real save/reload, real scan-delivery; scoped to the phrasings actually exercised live (§4) |
| **Screenshot (vision) door** | **4 — End-to-End** (moved this packet) | Real vision call, honestly-calibrated candidates (§4) |
| Vendor parity (translation layer vs. real vendor output) | **0 parity-comparable**, 4 vendor-semantics-only observations | Track A (§2) — do not read as parity evidence; still requires implementing the four functions to become parity-comparable |
| Dual-kernel (JS/Python) conformance | 2 — Integration | Self-consistency only, not vendor parity — see §9 |
| Save/persistence, screener artifact reachability, negative paths (Journeys #1–3) | 4 — End-to-End | Unchanged from Packet #1 |
| Screener execution (actual live scan results) | 0 — Exists (unverified) | Architecturally nightly-only by design; not this packet's scope |
| Cross-browser | 0 — Exists (unverified) | Chromium only, unchanged |

---

## 9. Test-Credibility Assessment

Carried forward from `TEST_CREDIBILITY_FINDINGS.md`, re-confirmed by this session's own
independent work rather than merely cited:

- **The central finding stands and was reinforced, not contradicted.** Dual-kernel agreement
  at 1e-9 tolerance and most golden fixtures prove only self-consistency (UCT agrees with
  UCT), not vendor parity — conflating the two has already caused two real production
  incidents (RISK-019 Cutler/Wilder RSI mislabel, RISK-020 doji misclassification), both
  caught by dedicated audits, not the ~9,600-test standing suite. Track A (§2) is the first
  real correction to this — 4 real vendor observations now exist where zero did at the time
  of that finding — but the underlying dimension (0 parity-comparable) is unchanged, because
  none of the four has a UCT engine implementation yet.
- Suite craftsmanship is otherwise genuinely high: real discriminating oracles wherever
  assertions exist, no mock-away-the-thing-under-test instances found, disciplined
  skip/xfail hygiene. The dominant risk is framed correctly as **missing dimensions, not
  weak checks** — and this packet's own new work is an instance of that framing holding:
  Track E's fixture-defect episode (§4) was a MISSING dimension (no test had ever reached a
  real, un-mocked model call before), not a weak assertion once it was reached.
  `TestSemanticCoverageGate`'s adversarial, never-seen-before-live-run prompts are new
  regression coverage added directly against this same finding.
- This packet's own work independently demonstrates the finding's practical stakes twice:
  the 21/48 vs. 28/48 discrepancy (§6) and the Track F parameter-count reproducibility gap
  (§5) were both cases of a claimed number that turned out to need re-derivation from
  running code rather than trust.

---

## 10. Remaining Known Gaps (not closed by this packet, not silently dropped)

- **RISK-004** (§6): the assisted-edit mechanism recovers zero additional blind-corpus
  scripts against the 28/48 target — currently 21/48, unresolved, no fix attempted here.
- **RISK-013** (§5): 7 of 9 input kinds, switch-driving inputs, numeric enums, and
  bar-displacement remain unimplemented for the parameter-fidelity feature.
- **RISK-018** (§2): 0 of 64 manifest functions are vendor-parity-comparable; the four
  Tranche 1A functions are vendor-semantics-captured only, pending implementation
  authorization that has not been given.
- **RISK-026** (§4): the single-word-named-indicator gap and the model-honesty dependency
  of the `unresolved` self-report mechanism, both explicitly disclosed above.
- Screener execution (actual live scans) remains architecturally nightly-only and
  unverified beyond that boundary (unchanged since Packet #1).
- Cross-browser testing remains Chromium-only (unchanged since Packet #1).
- Golden Journeys #1–3 (Pine/thinkScript/TC2000) remain one-off manual live-browser
  sessions with no CI automation — this is the one item blocking the Human Testing
  Readiness gate below.

---

## 11. Human Testing Readiness

`PHASE_ONE_PLAN.md` defines a 9-item gate before producing a formal Human Testing Readiness
Report (NOT READY / READY FOR LIMITED HUMAN QA / READY FOR BROAD HUMAN ACCEPTANCE TESTING).
Evaluated against current state:

| # | Gate item | Status |
|---|---|---|
| 1 | All five doors through ≥1 real E2E Golden Journey | **Met** — #1–3 (Packet #1) + #4–5 (this packet, §4) |
| 2 | Core vendor-observation store populated | **Met** — Track A, 4 observations, raw-artifact-backed |
| 3 | No known critical silent semantic wrong-answer defect | **Met, with the disclosed residuals in §10** — the two defects found in Track E's first run are the exact failure class this item guards against, and both are fixed with evidence; the single-word-name gap and model-honesty dependency are real but narrower than what was found and fixed |
| 4 | RISK-016/RISK-012-class member-facing defects fixed with regressions | **Met** — Track B |
| 5 | Five-event telemetry operating | **Met** — Track C |
| 6 | Existing Screener/Saved-Screen preservation checks green | **Met** — no regression found across this packet's full sweeps (498 tests, 0 failed, across every suite touching the AI-door code paths) |
| 7 | RISK-003 resolved or precisely isolated | **Met** — Track D, VERIFIED HEALTHY |
| 8 | Critical browser journey suite automated | **NOT MET** — Journeys #1–3 are one-off manual live-browser sessions, no CI automation; #4–5 are automated pytest but gated behind a scoped credential, not routinely run |
| 9 | Validation Coverage Map updated | **Met** — §8 above, and `VALIDATION_COVERAGE_MAP.md` |

**Recommendation: READY FOR LIMITED HUMAN QA, not yet READY FOR BROAD HUMAN ACCEPTANCE
TESTING**, pending item 8. Everything a human tester would exercise today has real,
recent, evidence-backed coverage; what's missing is the STANDING, automated guarantee that
this stays true as the codebase moves — Journeys #1–3 could silently regress with nothing
catching it, since they are not wired into any CI or scheduled rerun. This is not a
statement that a human should not test the product now — it is a statement about what
guards the product between now and the next time someone manually re-runs those journeys.

---

## 12. Recommended Next Phase

Given the gate evaluation in §11, two reasonable paths, presented as a choice rather than a
decision made here:

**(a) Close the item-8 gap first** — automate Journeys #1–3 into a scheduled or CI-triggered
suite (the pattern Journeys #4/#5 already established: a real credentialed run, evidence
captured, mechanically extracted, reviewed by a human/agent before promotion) — then produce
the formal Human Testing Readiness Report and move to broad human acceptance testing.

**(b) Proceed to limited human QA now**, explicitly scoped to the doors and journeys that DO
have current automated or recently-verified coverage, while item 8's automation work runs in
parallel rather than gating the whole program.

Both paths defer any new feature-phase work — RISK-004 (§6), the remaining RISK-013 input
kinds (§5), and RISK-018's implementation question (§2) are all explicitly **not**
recommended for this packet's authorization; each requires its own scoped decision.

---

## 13. Explicit No-Go Items — Not Authorized by This Packet

- Implementing any of the four Track A functions (`ta.rising`/`ta.median`/`ta.percentrank`/
  `ta.bbw`), or editing `closedTable.json`'s ruling text for them.
- Broadening Track F beyond `input.int`/`input.float` (the 7 remaining input kinds, switch
  inputs, enums, bar-displacement).
- Any fix attempt at RISK-004 (the 21/48 assisted-edit gap).
- Broadening the Track E semantic-safety fix further (e.g., closing the single-word-name gap
  or building a second-model verification layer for the `unresolved` self-report) — both are
  real, disclosed, and out of this packet's scope.
- Starting a new feature phase of any kind.
- Producing the formal Human Testing Readiness Report — §11 is this packet's assessment
  against the gate, not that report itself, which `PHASE_ONE_PLAN.md` specifies as a
  separate deliverable once item 8 is resolved (or explicitly waived by the owner under
  path (b) in §12).

---

## 14. Questions Requiring Owner/ChatGPT Review

1. Path (a) or (b) in §12 — close the Journey #1–3 automation gap first, or proceed to
   limited human QA in parallel?
2. Is the Track E semantic-safety fix's disclosed scope (§4) — pure-code named-phrase gate
   plus a model-honesty-dependent self-report gate — an acceptable standing posture, or
   does the single-word-name gap / model-honesty dependency warrant a follow-up track before
   any broader AI-door promotion?
3. Does RISK-018's "0 parity-comparable" state (real vendor semantics now held for 4
   functions, but no UCT implementation of any of them) warrant scheduling implementation
   work, or does that remain deliberately deferred pending a broader vendor-parity roadmap?
4. RISK-004 (21/48, zero assisted-edit uplift) — is this the next priority, or does it stay
   parked behind the two-path decision in Q1?
5. Confirm: no objection to the Track E credential-hygiene pattern used this packet
   (owner-provisioned, session-blind, cleared after use) as the standing procedure for any
   future credential-bearing verification work.
