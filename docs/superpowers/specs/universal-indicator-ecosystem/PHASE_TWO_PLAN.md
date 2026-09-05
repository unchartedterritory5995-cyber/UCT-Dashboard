# Phase Two — Standing Validation + Vendor Parity + Limited Human QA

Authorized 2026-09-05 by external owner/ChatGPT review of `CHATGPT_REVIEW_PACKET_02.md` (see DEC-013).
**Read this file's status table before trusting any item description below — it will go stale, per this
program's own Stale Documentation Principle (`RISK_REGISTER.md`).**

**Objective, in the owner's own words:** "the bottleneck should shift from 'does the infrastructure
basically work?' to 'can we continuously prove that what UCT claims to understand is semantically
correct?'" **This is explicitly NOT a feature-expansion phase.** No broad Pine-language expansion, no
Track F v2, no broad human acceptance testing, no new user-facing scripting language, no canonical-AST
rewrite, no execution-kernel replacement — see §9 for the full no-go list, unchanged from the
authorization.

Phase One is CLOSED and preserved as history (`PHASE_ONE_PLAN.md`). Phase One's Tracks A-F final
states are not re-litigated here; see `CHATGPT_REVIEW_PACKET_02.md` for the full record.

## The nine authorizing sub-decisions (full text: DEC-013)

| # | Topic | Ruling |
|---|---|---|
| 1 | Human QA path | Modified Path (a) — automate Journeys #1-3 first, then LIMITED, ADVERSARIAL human QA |
| 2 | Journey automation | Durable, deterministic, isolated-env regressions for #1-3; real product paths, not shallow substitutes |
| 3 | Vendor parity priority | Two-lane Tranche 2 (A: already-shipped functions; B: the four Track A functions) over parser-acceptance growth |
| 4 | RISK-004 | Stays OPEN; diagnose the 27-script failure distribution before building anything |
| 5 | RISK-026 residual | One narrow single-word-grounding hardening slice; no second-model verification architecture |
| 6 | Track F | Stays frozen at `input.int`/`input.float` |
| 7 | Screener-coverage clarification | Resolve before coding begins — **done same day, see §8 below** |
| 8 | Packet-HEAD provenance | Clarify, don't rewrite — **done same day**, see `CHATGPT_REVIEW_PACKET_02.md`'s preamble |
| 9 | Credential hygiene | No objection; standing procedure confirmed for all future credential-bearing work |

## Sequencing

**A** → automate Golden Journeys #1-3 (§1) → **B** → produce `HUMAN_TESTING_READINESS_REPORT.md`
(§1) → **C** → begin limited/adversarial human QA (§1) → **D** → Vendor Parity Tranche 2 Lane A (§2)
→ **E** → implement the four resolved functions against vendor goldens, Lane B (§2) → **F** → RISK-026
grounding-hardening slice (§3) → **G** → diagnose RISK-004's failure distribution (§4) → **H** → use
human QA + telemetry + parity evidence to decide the next capability tranche.

C/D/E/F may proceed in parallel where file/risk boundaries permit. **Evidence ownership must stay
unambiguous per finding** — this program has found and fixed the "second authority over one value"
defect class repeatedly (`lesson_a_second_authority_over_one_value`); do not let parallel Phase Two
work recreate it.

---

## §1 — Track G: Automate Golden Journeys #1-3

**Status: PLANNED, not started.** This section is the "bounded Journey #1-3 automation
implementation plan" the owner's First Return required before coding begins.

### Why this, why now, why bounded

Journeys #1-3 (Pine RSI, thinkScript ADX/DMI, TC2000/PCF long-term-uptrend) are real evidence — each
was run once, live, in a real browser, against the real product, with real findings (`CORE_GOLDEN_
JOURNEY_0{1,2,3}_*.md`). But they are **one-off manual sessions with zero CI or scheduled automation**.
`VALIDATION_COVERAGE_MAP.md`'s own honest framing: these could silently regress today with nothing
catching it. The owner's explicit bound: **"a short infrastructure close-out, not another research
project."** This plan does not redesign the journeys, invent new coverage, or expand scope beyond what
each journey's own doc already established as its behavior specification.

### Existing infrastructure this reuses, not reinvents

This repo already has a proven pattern for real-browser, Python-driven, local-backend E2E checks:
`tools/mobile_audit.py` (Playwright + Chromium already installed, local `uvicorn` backend, an
`ADMIN_EMAILS`-promoted test account that sees every route, no deploy wait). The Journey automation
follows the identical shape rather than inventing new tooling:

1. Boot the backend locally with heavy jobs disabled (`WORKER_ENABLED=0`,
   `CATALYST_ENGINE_ENABLED=0`, etc. — the same env-var set `mobile_audit.py`'s own header documents),
   against the repo-root `conftest.py`'s isolated sandbox pattern so nothing touches `C:\data`.
2. Create/reuse an admin test account.
3. Drive the real browser via Playwright through each journey's own documented step sequence.
4. Assert programmatically at each step (not eyeball a screenshot) wherever the original journey doc
   already recorded a checkable value (an exact string, a specific number, a specific refusal
   message) — screenshots captured as supplementary evidence, not as the pass/fail mechanism.
5. Write a structured result (JSON, mirroring `tools/track_e_run_golden_journey.py`'s own
   evidence-sidecar pattern) so a future run's pass/fail is machine-readable, not just a
   human-read log.

### Per-journey behavior specification (derived from each journey's own "chain" table — the owner's
own instruction: "use the existing Golden Journey evidence as the behavior specification")

**Journey #1 — Pine RSI** (`CORE_GOLDEN_JOURNEY_01_PINE_RSI_IMPORT.md`, 12 steps): paste
`07-rsi.pine` into the Import tab → detect Pine dialect → translate to canonical `rsi(close, 14)`
(assert the exact string) → canonical representation shows "3 nodes · 14-bar lookback · 1 series" +
non-repainting badge → `LEVELS: 70, 30` auto-populated, `PLACEMENT: Own pane` → live preview renders
→ save (assert "version 1, rev 1") → chart delivery (a real RSI subplot renders, value in a sane
0-100 band) → full-page reload (assert the indicator reappears, value recomputes rather than staying
cached) → screener reach (assert the exact refusal "1 saved formula cannot be a screen yet" for a
pure-numeric artifact) → screener execution (assert ENVIRONMENT-BLOCKED status, not a silent skip) →
negative path (`ta.cmf(20)`, assert exact refusal + Save no-op).

**Journey #2 — thinkScript ADX/DMI** (`CORE_GOLDEN_JOURNEY_02_THINKSCRIPT_ADX.md`, 13 steps): paste
`03-adx-dmi-lower.ts` → detect thinkScript → translate (assert the DI+ formula matches the
hand-verified algebraic form recorded in the journey doc) → canonical representation "22 nodes ·
15-bar lookback · 3 series" → no LEVELS (assert absence, not a fabricated default) → preview →
chart delivery (`declare lower` honored as own-pane, a plausible ADX value) → save (single instance,
no duplicate — this is where Journey #1 found RISK-012's double-click defect, so the automated
version must explicitly assert single-instance) → reload → My Formulas listing → screener reach
(identical refusal mechanism as #1, confirming door-agnosticism) → screener execution
(ENVIRONMENT-BLOCKED) → negative path, TWO distinct refusal shapes (`SimpleMovingAvg(varhigh,20)`'s
missing-default assisted-edit offer, THEN `high(period=Period)`'s hard missing-capability refusal
with no offer — assert both, and assert the assisted-edit fix, once accepted, actually produces a
working translation).

**Journey #3 — TC2000/PCF** (`CORE_GOLDEN_JOURNEY_03_TC2000_PCF_IMPORT.md`, 13 steps): paste
`long_term_uptrend`'s PCF source → detect TC2000 → translate (assert exact match against
`pcf_corpus.json`'s own declared expected native — a real corpus-declared known-answer check, not
this plan's own invention) → canonical representation "8 nodes · 200-bar lookback · 1 series" →
validation left blank deliberately (assert the AND-of-comparisons is still recognized as boolean
without an explicit threshold) → preview → chart delivery (assert the exact value 1.00, which is
provably correct given SPY's real MA state at capture time — **this assertion needs a
point-in-time-aware rewrite**, see Risks below) → save → reload → My Formulas listing → screener
reach (assert ACCEPTED, the real divergence from #1/#2's numeric refusal) → screener execution
(ENVIRONMENT-BLOCKED) → negative path (`FibExtension(...)`, assert exact character position named
in the refusal).

### Risks / known adaptation needed (disclosed up front, not discovered mid-implementation)

- **Journey #3's exact "1.00" assertion is time-dependent** — it was correct because SPY's real
  close/50/200-day MA relationship happened to be in a specific state on the day of manual capture.
  An automated, repeatedly-run version cannot hardcode "1.00" as a universal pass condition; it must
  either (a) independently compute the expected boolean from the same real bars the app itself would
  fetch at run time and assert equality (preserving the "provably correct, not just plausible" bar
  the original journey set), or (b) pin the automation to a frozen historical bar range where the
  answer is known and stable. Preferred: (a), since it also re-proves canonical compilation is final
  authority on every run rather than freezing one day's answer.
- **RISK-012's double-click defect is already fixed** (Phase One, Track B) — the automated Journey #1
  should assert single-instance-after-save as a REGRESSION guard, not as if re-discovering the bug.
- **Isolation cost**: each journey's own doc notes a fresh sandbox/test-account setup cost (~model
  minutes in the original manual runs). Automating three journeys inside one script, reusing one
  backend/sandbox lifecycle across all three (mirroring the original manual session's own
  "housekeeping" carry-forward between #2 and #3), keeps this bounded rather than tripling setup cost.
- **Do not let this become a fourth Golden Journey research project.** If the automated run surfaces
  a genuinely NEW finding (not already documented in the three journey docs), record it as its own
  RISK_REGISTER entry and keep moving — do not redesign the journey to chase it inside this tranche.

### Deliverable

`tools/golden_journey_pine_thinkscript_pcf.py` (or three smaller scripts sharing one harness module)
+ a structured JSON evidence sidecar per run + a short results doc
(`GOLDEN_JOURNEY_01_02_03_AUTOMATED_RESULTS.md`, mirroring `GOLDEN_JOURNEY_04_05_LIVE_RESULTS.md`'s
own reviewed-not-mechanical pattern). Once green and reviewed: produce
`HUMAN_TESTING_READINESS_REPORT.md` per `PHASE_ONE_PLAN.md`'s own 9-item gate (item 8 is the one this
closes) and reclassify readiness from actual evidence.

---

## §2 — Vendor Parity Tranche 2

**Status: PLANNED, not started.**

### Lane A — already-shipped core functions, ranked by real evidence

Derived from: full 64-function manifest read (`closedTable.json`), real corpus-frequency counts
(regex function-call counts across all 123 `.pine`/`.ts`/PCF fixture files), `RISK_REGISTER.md`'s
named historical incidents, `tests/fixtures/vendor/divergences.json`'s already-flagged-but-unverified
convention disputes, existing `tools/vendor_spec_probes.py` coverage (4 functions: atr/ema/rma/sma,
spec-level only, never real-vendor-runtime), and each function's stated statefulness/smoothing risk.
Methodology and full reasoning: see the fork transcript referenced in this file's own git history;
summarized here as the actionable list.

**Priority order for real TradingView capture:**

| # | Function | Why (evidence, not assertion) |
|---|---|---|
| 1 | `rsi` | The ONLY function with a **confirmed production incident** — RISK-019 shipped Cutler's RSI under Wilder's name, 525/2,748 rows on the wrong side of 70/30. Stateful (built on `rma`). |
| 2 | `atr` | 2nd-most-used in corpus (35 hits); `divergences.json`'s `atr-tr-starts-at-bar-1` is `status:"accepted"` — a real, documented convention question never checked against real TradingView; feeds position sizing directly. |
| 3 | `sma` | Highest-frequency function in the entire corpus (185 hits); foundational to nearly every other stateful function's convention questions; spec-probe-covered already, so real capture is the natural next rigor step. |
| 4 | `ema` | 2nd-highest frequency (134 hits); manifest's own smoothing note flags a subtle seed-convention distinction from `rma`. |
| 5 | `rma` | Only 8 direct hits but transitively load-bearing for `rsi`+`atr` (and likely `adx`) — this program's own stated lesson: "a stateful disagreement compounds — one differing bar changes every later bar." Highest transitive risk on this list. |
| 6 | `hma` | `divergences.json`'s `hull-half-window-floors` is `status:"confirmed"` — a MEASURED divergence (floor(n/2) rounding) never checked against a real TradingView run. |
| 7 | `macd` | Multi-stage composite of `ema`; high member-facing visibility; zero spec-probe coverage. |
| 8 | `stoch` | Real vendors disagree on %K smoothing in ways structurally similar to the rsi/atr class; zero existing coverage. |
| 9 | `adx`/`plusDI`/`minusDI` | Zero corpus hits (flagged honestly, not omitted) — but `CORE_GOLDEN_JOURNEY_02_THINKSCRIPT_ADX.md` already disclosed DI-/ADX as NOT independently hand-verified (only DI+ was); this tranche directly closes that stated scope limit. |
| 10 | `wma` | Moderate frequency (20 hits); `hma`'s own formula is built from `wma`, so a `wma` error would silently masquerade as a false "hma is fine" result. |

Everything else on the 64-function manifest is either purely stateless arithmetic with no real
vendor-convention ambiguity, or has zero flagged history — deliberately excluded from this initial
top-10, not overlooked. Re-rank after this tranche's first real captures land, since a real
divergence found on one function may re-order the rest.

**Mechanism:** reuse Track A's proven pattern (`tools/track_a_ingest_vendor_capture.py` — cross-
validation, control-value checks, raw-artifact preservation) generalized beyond the four already-
supported oracle functions to these ten, one at a time, in priority order. Each observation, once a
UCT implementation exists for that function, becomes genuinely **parity-comparable** — the dimension
that has been at 0 since this program began.

### Lane B — the four Track A semantics-resolved functions

**Authorized, provided each lands with its captured TradingView raw artifact as the golden oracle**
(`tests/fixtures/vendor/raw_captures/2026-09-05-tv_oracle_capture_2026-09-05.csv`), making each
parity-comparable from the moment it ships, not merely another self-consistency test:

- `ta.rising` → strict monotone over length+1 samples (not running-maximum)
- `ta.median` (even length) → mean-of-the-two-middles (not lower-of-the-two-middles)
- `ta.percentrank` → divide by L, current bar excluded (not L+1)
- `ta.bbw` → the percent form, ×100 (not the raw ratio)

**Required evidence chain per function** (owner's own wording): vendor artifact → exact semantic
ruling → implementation → JS/Python conformance → vendor comparison → parity observation →
regression test. **No other previously-excluded function is authorized merely because these four
are** — each of the 60 remaining excluded functions needs its own future authorization.

**Sequencing note:** per DEC-013, Lane A begins before Lane B's implementations ship, so the parity-
comparable pattern is established on already-shipped functions first, then Lane B's four
implementations plug directly into that same pattern rather than repeating Track E's own lesson
(self-consistency evidence looking like more than it is).

---

## §3 — RISK-026 Residual: Single-Word Named-Concept Grounding

**Status: PLANNED, research-first, not started.**

**Objective, exactly as authorized:** if a member names an indicator/concept UCT cannot ground to a
supported concept/function, UCT must refuse rather than silently substitute — closing the gap the
two-or-more-word `_named_phrases()` heuristic (Phase One, Track E) does not cover (e.g. "Aroon" alone).

**Required research before any code**, per the owner's explicit instruction:
- Grammar/context around named-indicator references in real member phrasing (how does "plot Aroon,"
  "use the Aroon indicator," "Aroon of the close" differ syntactically from ordinary English that
  happens to contain a capitalized word?).
- Existing closed-vocabulary matching and supported aliases — does extending `plan()`'s lexicon
  matching to single capitalized words, GATED on a signal beyond bare capitalization (e.g. a
  preceding/following "indicator"/"of"/"plot the" context word), reduce false-positive risk enough
  to be viable?
- Explicit false-positive testing against ordinary English (single capitalized words are common:
  sentence-initial words, tickers, "I") — this is precisely the failure mode that made the first
  Track E design attempt (a fully-unanchored-clause check) too broad; the same discipline applies
  here at a narrower scope.
- Whether grounding can be checked **deterministically** (code-only, matching mechanism 1's
  guarantee from Track E) or whether this specific class genuinely requires model cooperation (in
  which case, per the owner's explicit instruction, **no second-model verification architecture is
  authorized** — the `unresolved` self-report field stays defense-in-depth, not a foundation to build
  a bigger verification system on top of).

**Explicit boundary:** this slice does not need to understand every unknown indicator. It needs
UCT to correctly say "I don't know that one" instead of silently answering a different question.

---

## §4 — RISK-004 Diagnostic Decomposition

**Status: PLANNED, not started. Diagnosis only — no fix authorized yet.**

Currently: 21/48 blind-corpus scripts translate; the assisted-edit mechanism recovers zero
additional scripts (0 uplift over the pre-assisted-edit base rate). Before building anything, classify
the 27 failing scripts' failure causes:

- unsupported function
- unsupported syntax
- parser limitation
- parameter/input limitation
- execution-policy limitation
- data limitation
- translator semantic uncertainty
- assisted-edit mechanism defect
- correctly refused (the failure IS the correct behavior)

**Do not optimize a headline acceptance percentage blind to this distribution.** A script correctly
refused for naming a genuinely unsupported concept is a different finding than a parser bug — the two
categories imply completely different next actions, and conflating them (as the original,
now-corrected "28/48" claim may have done) is exactly the kind of unreproducible-claim failure this
program has already found and fixed twice this phase (§5, §6 of `CHATGPT_REVIEW_PACKET_02.md`).

---

## §5 — Human Testing Readiness (tracking)

Gate items from `PHASE_ONE_PLAN.md`, items 1-7 and 9 already Met per `CHATGPT_REVIEW_PACKET_02.md`
§11. Item 8 (critical browser journey suite automated) is §1 above — the one gate item Phase Two's
sequencing step A closes. Once green: produce `HUMAN_TESTING_READINESS_REPORT.md` and reclassify from
"READY FOR LIMITED, ADVERSARIAL HUMAN QA" (current) toward whatever the actual evidence supports next.

**The stated purpose of limited QA, verbatim:** discovery — specifically finding semantic,
browser/workflow, persistence, and cross-surface failures not represented in the existing Golden
Journeys. Not a rubber-stamp exercise.

---

## §6 — Screener-Coverage Clarification (resolved)

Investigated 2026-09-05 per DEC-013 item 7. Conclusion: **not a contradiction, but the coverage-map
row was incomplete.** `scan_coverage.MAX(as_of)` (Track D) proves the nightly sweep runs to
completion, on schedule, against the full 3,742-ticker universe, with real non-zero hits — a
`scan_coverage` row is written only when a definition completes (`scan_evaluator.py` — a half-run
leaves no receipt), so this is real completion/liveness evidence, not a heartbeat. It does **not**
prove the matched-ticker set for a given AST is the *semantically correct* membership — no test or
process anywhere independently derives an expected answer and compares. `VALIDATION_COVERAGE_MAP.md`'s
"Screener execution" row has been updated to say both things explicitly: partially superseded
(completion/liveness), still open (result correctness). Not this phase's scope to close the
remaining gap — noted for a future tranche if member-facing scan correctness becomes a priority.

---

## §7 — Credential Hygiene (standing procedure, confirmed)

No changes from Track E's pattern, now standing for all future credential-bearing verification work:
owner-provisioned scoped test credential → isolated environment → no production-member data → no
production-key fallback → secret never printed/persisted/logged by any tool → independently
revocable/removable by the owner at any time, including mid-session.

---

## §8 — Provenance Note

This file's own creation commit and `CHATGPT_REVIEW_PACKET_02.md`'s HEAD-provenance clarification
(DEC-013 item 8) both land in the same work session as this plan — see git history for the exact
commit sequence rather than a hand-typed hash here, per this program's own "measure it, don't quote
it" discipline for anything that will move.

---

## §9 — Explicit No-Go (unchanged from the authorization)

Broad Pine-language expansion · Track F v2 input expansion · broad human acceptance testing ·
uncontrolled AI semantic guessing · a true full-universe intraday pipeline ·
`SCAN_LIVE_SWEEP_ENABLED` rollout · a new user-facing scripting language · a canonical-AST rewrite ·
execution-kernel replacement · tech-stack modernization for its own sake.
