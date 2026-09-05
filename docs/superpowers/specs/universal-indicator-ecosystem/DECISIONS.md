# Decision Records — Universal Custom Indicator + Screener Ecosystem

Format per master-prompt §77: Decision / Context / Evidence / Alternatives / Why chosen / Risks /
Migration impact / Reversibility / Tests needed / Date. Append-only; never edit a shipped entry's
substance — add a new entry that supersedes it and link back.

---

## DEC-001 — Program scope: extend the existing Indicator Platform program, do not reset it

**Decision:** The 7/31-approved Indicator Platform architecture, its shipped Phase A (signature
indicators + signal ledger), and ongoing Pine/thinkScript translation work are the baseline for this
program. Extend and harden them. Do not perform a full reset. Do not reopen a previously-settled
decision merely because the master prompt raises the topic as an option.

**Context:** Phase Zero orientation (2026-09-04) discovered a mature, active, owner-approved program
already running in exactly the space the master prompt describes — one the master prompt's own framing
(§6 "Discovery Before Build", §88 "map the existing ecosystem") did not appear to assume was this far
along. Continuing as if this were a blank slate risked redundant rediscovery at best and disrupting a
near-ship-date, in-flight effort at worst.

**Evidence:**
- `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` — approved roadmap, 4 research
  reports + 5-seat panel review.
- `docs/superpowers/plans/2026-07-31-phase-a-signature-launch.md` — Phase A implementation plan.
- `api/services/signature/{rules,darkpool_levels,flow_breakout,gex_walls,ledger,sweep,confluence,registry_defs}.py`
  and `api/routers/signature.py` — present on `origin/master` (verified via `git ls-tree origin/master`,
  2026-09-04). `confluence.py` and `registry_defs.py` are not described in the Phase A plan text Claude
  read — the implementation grew beyond its own spec.
- `origin/master` commit log includes active, recent Pine/thinkScript/pattern-engine work: e.g.
  `feat(pine): a run-length counter is a bounded question, so bound it`,
  `ruling(bbw/percentrank/median): three names researched, three refused, reasons kept`,
  `thinkscript: Inertia is a linear regression, at zero new vocabulary`,
  `Segment G6: the member's grammar reference, generated from the manifest`.
- `C:\Users\Patrick\uct-worktrees\indicator-endzone` — worktree directory modified 2026-09-04 08:17,
  hours before this Phase Zero session started.
- Numerous other live/recent worktrees touching adjacent systems: `phase-b1-foundations`,
  `phase-b2-engine`, `candle-library`, `screener-deep-work`, `patterns-retire`, `live-scan-retire`.

**Alternatives considered:**
- Full reset — treat the master prompt as authoritative over the 7/31 doc, re-evaluate every prior
  decision including already-shipped direction.
- Case-by-case — no blanket policy; bring every concrete tension to the owner individually as found.

**Why chosen:** Explicit owner ruling, 2026-09-04 (verbatim in `00-MASTER-PROMPT.md` §3). Rationale
given: the 7/31 program represents real, working, already-valuable product infrastructure; the master
prompt's ambition is additive to it, not a replacement mandate.

**Risks:** "Preserve unless new evidence" could be applied too conservatively and under-invest in
genuinely valuable new directions the master prompt raises. Mitigated by: (a) the owner's own 8-point
establishment list below, which is mandatory regardless of this decision; (b) an explicit conflict
policy (see DEC-001 "conflict policy" note) that still allows individual decisions to be reopened on
real evidence and routed to owner/ChatGPT review.

**Conflict policy (owner-specified, applies to all future decisions in this program):**
1. Prior decision + no new contrary evidence → preserve it.
2. Prior decision + master prompt merely raises an option → do not reopen automatically.
3. Prior decision + new measurable evidence creates a genuine tension → document the evidence, route to
   owner/ChatGPT review (Bucket C). Do not resolve unilaterally.
4. Current implementation differs from the old approved spec → treat current code/runtime behavior as
   evidence, determine *why* it diverged, and do not automatically "correct" it back to the document.

**Migration impact:** None directly — this is a scope/process decision, not a code change.

**Reversibility:** Fully reversible at any time by the owner; per-decision reopenings are explicitly
permitted under the conflict policy above.

**Tests needed:** N/A directly. The owner's 8-point establishment list (tracked in `PROGRESS.md`)
functions as the verification plan for whether this baseline is accurately understood.

**Date:** 2026-09-04

---

## DEC-002 — Preserve "no standalone user-facing scripting language as a product"

**Decision:** The 7/31-approved decision to kill a standalone user-facing scripting language as a
product stands. Master-prompt §15 ("First-Class Native Creation" — evaluate a native UCT DSL among
options A–G) is downgraded from a directive to a RESEARCH/HYPOTHESIS item. The internal canonical
grammar/IR (used by the compiler/execution kernel) is a distinct concept from a user-facing authoring
language and is **not** affected by this decision — it may still grow in whatever way genuinely serves
Pine/thinkScript/TC2000 translation, static analysis, and execution.

**Context:** Master-prompt §14–15 describes five import doors (Pine, thinkScript, TC2000, plain
language, screenshot) plus an open research question about whether UCT should also offer a native
authoring DSL. The 7/31 doc had already explicitly settled the authoring-surface question in the
negative, in favor of versioned declarative "definitions" + a curated library + a later no-code builder
(Phase D) + an AI concierge (NL → definition, subsuming what a scripting tier would have done).

**Evidence:**
- `2026-07-31-indicator-platform-design.md` §0: *"A standalone user-facing scripting language is
  **killed** as a product; its sandbox survives as plumbing for AI-generated definitions."*
- Same doc §11 (adjudicated decisions log): *"Scripting tier (P3) | **Killed as product**; sandbox = AI
  plumbing only; revisit 2027 on demand | Trader + CEO; TV marketplace war settled; solo-owner
  security/support tax."*

**Alternatives considered:** Reopen and evaluate a native DSL now, per master-prompt §15's option list
(A: native DSL, B: Pine-like mode, C: thinkScript-like mode, D: multiple compatibility modes, E: visual
builder, F: plain-language-first, G: hybrid).

**Why chosen:** Explicit owner ruling, 2026-09-04. The owner reframed the actual objective: *"Give users
a powerful first-class way to create custom indicators/scanners inside UCT while allowing them to use
languages and mental models they already know — Pine, thinkScript, TC2000-style formulas, plain
English, screenshots/recreation, and whatever canonical internal representation UCT needs underneath."*
That objective does not require a new proprietary authoring syntax; import/translation doors plus the
existing definition-based authoring model can plausibly satisfy it.

**Risks:** Import-door translation work (Pine/thinkScript parsers) could drift into a de facto authoring
surface if, e.g., members are ever allowed to hand-edit translated/canonical source text freely rather
than edit structured definition fields/parameters. That would functionally recreate the killed
scripting-tier product without anyone deciding to. **Flag for the Compiler/IR Architect and Product
Designer workstreams explicitly** — any editor/authoring UX proposal should be checked against this
boundary before it ships.

**Migration impact:** None.

**Reversibility:** Owner has explicitly reserved the right to reopen this "if Phase Zero uncovers
specific evidence that a native authoring surface would materially improve the product and cannot be
achieved cleanly through the existing architecture." Any such evidence goes through the conflict policy
in DEC-001 (Bucket C — owner/ChatGPT review), not a unilateral reversal.

**Tests needed:** N/A directly, but any future editor/authoring UX work should be checked against the
free-text-editing boundary described under Risks before shipping.

**Date:** 2026-09-04

---

## DEC-003 — Phase One scope: preserve the core architecture; build a Trust Foundation, not a rewrite

**Decision:** External owner/ChatGPT review of `CHATGPT_REVIEW_PACKET_01.md` is complete. Verdict: **the
canonical AST, single-write-door model, dual execution kernels, manifest-driven static analysis, existing
screener integration, and five-door architecture are all preserved** — Phase Zero produced no evidence
justifying replacement of any of them (matches this program's own §19 finding). The next phase is **Phase
One — Trust Foundation**: turn a sophisticated, largely-working system into one whose semantic correctness,
operational reliability, observability, and real product behavior are sufficiently demonstrated to support
the larger objective. Six parallel workstreams authorized (Track A Vendor Parity, B Known Defects, C
Telemetry, D Production Scan Truth, E AI-Door Golden Journeys, F Imported Parameter Contract ADR), plus a
documentation wording correction and a release/human-QA readiness gate. Full detail in `PHASE_ONE_PLAN.md`.

**Context:** This is the direct successor decision to DEC-001/DEC-002, made by the same owner/ChatGPT review
process this program's own §21 asked for.

**Evidence:** `CHATGPT_REVIEW_PACKET_01.md` (all 21 sections, especially §17-20); the owner's verbatim
review response (2026-09-04), which resolves all 10 of §21's questions (recorded individually below and in
`PHASE_ONE_PLAN.md`).

**Alternatives considered:** None presented by the owner — this was a direct verdict, not a menu.

**Why chosen:** Explicit owner/ChatGPT ruling.

**Risks:** Six parallel tracks touching real product code (not just documentation, unlike Phase Zero) risk
merge conflicts and quality dilution if parallelized carelessly. Mitigated by: small, independently-
reviewable changes per the owner's own instruction; sequencing Track E behind Track B's RISK-016 fix;
routing Track A's vendor-runtime captures through careful, evidence-quality-conscious work rather than
automated bulk collection.

**Migration impact:** None to product behavior yet — this is a scope/planning decision. Product changes
begin under Track B.

**Reversibility:** Fully reversible; a future Review Packet (#2, required before any global live-sweep
enablement, broad intraday rollout, architecture replacement, or broad human-QA recommendation) is the next
checkpoint.

**Tests needed:** Per-track, specified in `PHASE_ONE_PLAN.md`.

**Date:** 2026-09-04

---

## DEC-004 — Confluence: conditional retirement, not automatic wiring; never rename the shipped surface

**Decision:** Do not finish wiring `confluence.py`'s `dpc-v1` merely because the prototype exists. Determine
whether there is a current owner-approved near-term product requirement for it; if none, recommend formal
retirement after verifying no active dependency; if it must remain, rename the *prototype* (never the live
member-facing Confluence Radar) to an explicit dark-pool/reclaim-oriented internal name, with cross-
referencing docstrings recording the distinction.

**Context:** RISK-001 (naming collision) and RISK-002 (`dpc-v1` unreachable) — owner's answer to §21 Q1.

**Evidence:** `RISK_REGISTER.md` RISK-001/002; `CURRENT_ARCHITECTURE.md`'s "Known drift and naming issues."

**Alternatives considered:** Finish wiring `dpc-v1` unconditionally (rejected — no requirement established);
rename the shipped Confluence Radar instead (explicitly rejected by the owner).

**Why chosen:** Owner ruling, 2026-09-04 — avoids investing engineering effort in a prototype with no
established near-term need, while explicitly protecting the shipped, member-facing surface's name.

**Risks:** None significant — this is a naming/retirement decision on an already-unreachable prototype.

**Migration impact:** None until the dependency check and rename/retirement actually execute (Track B/owner
routing, not yet performed).

**Reversibility:** Fully reversible.

**Tests needed:** A dependency check (grep + `registry_defs.py` review) before either path.

**Date:** 2026-09-04

---

## DEC-005 — Toolkit commercial tiering: deferred, current entitlements preserved

**Decision:** Defer the toolkit tiering/pricing decision (§8.4). Preserve current behavior/entitlements
exactly as they are (`entitlements.TOOLKITS` stays at one ungated toolkit). Pricing must not block Phase One
engineering. Telemetry (Track C) should eventually provide real toolkit-usage evidence before a larger
commercial decision is made.

**Context:** Owner's answer to §21 Q2.

**Evidence:** `CURRENT_ARCHITECTURE.md` Phase E status; `entitlements.py`'s own docstring calling this
explicitly open.

**Alternatives considered:** Resolve tiering now (rejected — a business decision, not a Phase One
engineering priority, and no usage evidence yet exists to inform it).

**Why chosen:** Owner ruling — sequences the decision behind the evidence (telemetry) that should inform it.

**Risks:** None to Phase One; a future commercial decision remains fully open regardless of any Phase One
code changes.

**Migration impact:** None.

**Reversibility:** Fully reversible; this is a "not yet," not a "no."

**Tests needed:** N/A directly.

**Date:** 2026-09-04

---

## DEC-006 — Pine input-parameter fidelity: pursue, contract-first

**Decision:** Direction is **yes** — for supported imported Pine `input()` declarations, UCT should
increasingly preserve safe parameter metadata and expose compatible values as adjustable UCT inputs, rather
than silently freezing everything at defaults (RISK-013). **Design the parameter contract before broad
implementation** — an ADR (Track F) must precede the mapping work. The contract must consider: source name,
display/title, type, default, current value, min/max, step, enum/options, and semantic effect on lookback/
data/execution requirements. Only expose a source input as adjustable where UCT can preserve its semantics
safely; unsupported/dynamic cases preserve the default and **disclose the limitation** rather than inventing
compatibility. Changing an exposed input must re-run whatever static/execution-requirement analysis it can
affect.

**Context:** RISK-013, found in Core Golden Journey #1 (a 97-line Pine RSI script's 5 adjustable inputs did
not carry over; only their defaults did). Owner's answer to §21 Q3.

**Evidence:** `CORE_GOLDEN_JOURNEY_01_PINE_RSI_IMPORT.md`; `RISK_REGISTER.md` RISK-013.

**Alternatives considered:** Leave as-is (rejected — a real fidelity gap the owner wants closed); auto-
expose every input without a safety/semantics check (explicitly rejected — "unsupported/dynamic cases
should preserve the default and disclose the limitation rather than inventing compatibility").

**Why chosen:** Owner ruling — closes a real fidelity gap while explicitly guarding against the "invented
compatibility" failure mode this program's addendum warns about throughout.

**Risks:** A naive mapping could silently misrepresent an input's true semantic effect (e.g., exposing a
parameter whose change should invalidate a cached execution-requirement contract but doesn't). Mitigated by
the ADR-first requirement and the explicit "re-run static/execution-requirement analysis" clause.

**Migration impact:** None until Track F's ADR lands and is reviewed; no implementation begins before that.

**Reversibility:** Fully reversible pre-implementation; the ADR itself is the reversibility checkpoint.

**Tests needed:** Defined in the ADR; at minimum, per-type-safety-tier fixtures and a regression proving an
unsupported case discloses rather than fabricates.

**Status update (2026-09-05):** The ADR chain landed and was accepted (`TRACK_F_PARAMETER_ADR_V2.md` →
`_V2_1.md` → `_V2_2.md`), a 15-point pre-implementation spike passed 21/21 and was accepted
(`TRACK_F_SPIKE_REPORT_V1.md`), and the owner then authorized narrow v1 implementation. **v1 is now
implemented, live-verified, and ACCEPTED**: `input.int`/`input.float` — including the window/length-bound
case (`length`) that RISK-013's own motivating fixture needed — are adjustable, server-protected
(canonicalize-from-`prev`, reject-not-clamp), and persisted, verified via a live browser rerun of
`07-rsi.pine` plus a direct database read. A same-day follow-up additionally verified and permanently
regression-tested reopening an already-saved definition to keep tuning its parameter, through the existing
`PUT /{def_id}`/`openForEdit` door (no new architecture). Full evidence:
`TRACK_F_V1_IMPLEMENTATION_COMPLETION_REPORT.md`. **Still not started, by deliberate scope**: `input.bool`/
`input.string`/`input.source`/`input.timeframe`/`input.symbol`/`input.time`/`input.color`, switch/branch-
driving inputs, numeric `options` enums, bar-displacement (`close[n]`) inputs. Track F is stopped here
pending a separate future authorization for any of those.

**Date:** 2026-09-04 (v1 implementation accepted 2026-09-05)

---

## DEC-007 — Vendor-parity observation capture: standing engineering discipline, not a one-time backfill

**Decision:** Populating `tests/fixtures/vendor/observations/` (RISK-018) becomes a **standing engineering
discipline**, not a one-time backfill. Use the already-built Vendor Oracle infrastructure as-is unless
execution reveals a real deficiency — do not redesign it preemptively. Create an initial prioritized
function list: (1) core/high-use technical functions, (2) known ambiguous functions, (3) functions
implicated in current blind-corpus misses, (4) functions involved in previous parity incidents (RISK-019,
RISK-020's precedent class). Assign a named **Vendor Parity Owner** role (ideally QA/reliability, not solely
the translator implementer). Capture multiple discriminating observations for important stateful/vendor-
sensitive functions. New observations are added when: a vendor function is newly supported; vendor-sensitive
semantics change; a compatibility bug is reported; a vendor ambiguity is discovered; a material vendor
runtime change is suspected. Define compatibility tiers so internal JS/Python conformance can never again be
confused with vendor parity (the RISK-018/§6 conflation risk).

**Context:** RISK-018 — the lead finding of the entire Phase Zero test-credibility audit. Owner's answer to
§21 Q4.

**Evidence:** `TEST_CREDIBILITY_FINDINGS.md`; `RISK_REGISTER.md` RISK-018/019/020; `VALIDATION_COVERAGE_MAP.md`'s
dedicated vendor-parity row.

**Alternatives considered:** One-time backfill of the harness's stated minimum ("three observations, one per
shape") and stop (rejected — the owner explicitly wants an ongoing discipline, not a single measurement).

**Why chosen:** Owner ruling — treats vendor-parity evidence as a maintained asset, matching the severity
this program assigned the underlying gap (S1-adjacent).

**Risks:** Without a named owner and trigger conditions, this discipline could decay back into a one-time
event. Mitigated by the explicit role assignment and the five named trigger conditions above.

**Migration impact:** None to product code; this is a testing/evidence discipline.

**Reversibility:** Fully reversible; the discipline can be scaled up or down based on what Track A's initial
tranche actually finds.

**Tests needed:** New vendor-observation fixtures feed directly into CI per Track A's plan.

**Date:** 2026-09-04

---

## DEC-008 — Scoped Anthropic key for AI-door verification: approved, conditional on RISK-016 first

**Decision:** A scoped, Phase-Zero/One-only Anthropic API key is **approved** for provisioning — but only
**after RISK-016 is fixed and regression-tested**. Use it in the isolated development/testing environment
only, with controlled/non-member fixtures, and enable the screenshot feature (`INDICATOR_VISION_ENABLED`)
only in that isolated validation environment. Once provisioned, complete the real model-call portions of
Golden Journeys #4 and #5 (Track E). Never use production member data to satisfy this test.

**Context:** Core Golden Journeys #4/#5 were both ENVIRONMENT-BLOCKED in Phase Zero for reasons unrelated
to product correctness (no API key; a deliberately-off feature flag). Owner's answer to §21 Q5.

**Evidence:** `CORE_GOLDEN_JOURNEY_04_PLAIN_LANGUAGE.md`, `CORE_GOLDEN_JOURNEY_05_SCREENSHOT_VISION.md`;
`RISK_REGISTER.md` RISK-016.

**Alternatives considered:** Provision the key immediately, in parallel with Track B (rejected — the owner
wants RISK-016 fixed first, since testing an AI door still carrying a known, misleading-error bug would
produce noisy, hard-to-interpret results); use a production key (explicitly rejected).

**Why chosen:** Owner ruling — sequences correctness-blocking-bug remediation ahead of spending on live model
calls that would otherwise partially fail for an already-known, unrelated reason.

**Risks:** None significant if the sequencing is honored; the main risk is proceeding with Track E before
RISK-016 actually lands, which this decision explicitly forbids.

**Migration impact:** None to shipped product; a new, scoped credential is a test-environment addition only.

**Reversibility:** Fully reversible; the key is explicitly scoped and revocable.

**Tests needed:** RISK-016's own regression test must be green before this decision's Track E work begins.

**Date:** 2026-09-04

---

## DEC-009 — `SCAN_LIVE_SWEEP_ENABLED`: not armed yet; staged canary required

**Decision:** Do **not** arm `SCAN_LIVE_SWEEP_ENABLED` in Phase One. Required first, in order: (1) resolve
RISK-003 with direct production evidence; (2) establish appropriate telemetry/observability for the live-mode
path; (3) verify rollback/disable behavior; (4) establish a controlled canary plan; (5) verify the AST
engine's relevant safety/coverage contracts (the cadence-ceiling honesty guard, four-outcome coverage
accounting) under the new cadence. If all five pass, propose a limited internal/staff canary before any
member exposure. No global enablement in Phase One without another review checkpoint.

**Context:** RISK-003 (PRODUCTION-UNVERIFIED) directly gates this; the Screener Live Tier precedent
de-risks the underlying recompute-off-shared-snapshot mechanism but not the AST engine's additional
complexity, which has never run live even once. Owner's answer to §21 Q9.

**Evidence:** `RISK_REGISTER.md` RISK-003; `DATA_EXECUTION_FINDINGS.md`'s bucket-3 analysis.

**Alternatives considered:** Arm it now that the mechanism is de-risked by the Live Tier precedent
(explicitly rejected — the owner distinguishes mechanism risk from the AST engine's own untested complexity).

**Why chosen:** Owner ruling — a staged, evidence-gated rollout for a feature that has never executed live,
on a shared production scheduler, touching every member's screener results.

**Risks:** Delaying this indefinitely if RISK-003 or the canary plan stalls. Mitigated by naming this
explicitly in Track D and the Review Packet #2 checklist.

**Migration impact:** None — the flag stays off.

**Reversibility:** Fully reversible (it's an unset flag).

**Tests needed:** All five gate conditions above, each independently verifiable.

**Date:** 2026-09-04

---

## DEC-010 — True sub-daily intraday scanning: long-term yes, not this phase; immediate backend gate required

**Decision:** Long-term product direction is **yes** — plan for true intraday custom-indicator screening
eventually. **Do not build the full intraday pipeline in Phase One.** Immediately add/verify a backend
execution gate (RISK-017) so an unsupported intraday request cannot be accepted merely because the frontend
currently hides those choices — independent of any product decision to widen the UI. Keep current UI
timeframes unchanged. Later, prepare a bounded vertical-slice RFC covering 60m/15m/5m: data availability,
forming bars, sessions, performance, caching, universe scale, provider constraints, and execution
requirements. **Explicitly distinguish** "Run Now" (already exists, bounded, shipped) from true sub-daily
timeframe scanning (does not yet have the necessary data pipeline) in all future product/technical
communication.

**Context:** RISK-017 (on-demand door has no code-level intraday-tf refusal) and `DATA_EXECUTION_FINDINGS.md`'s
bucket-5 finding (the dominant genuine hard constraint: no forming-bar builder for intraday exists in the
live path). Owner's answer to §21 Q10.

**Evidence:** `DATA_EXECUTION_FINDINGS.md`; `RISK_REGISTER.md` RISK-017.

**Alternatives considered:** Build the intraday pipeline now (rejected — bucket-5's data-pipeline limitation
is real and unmeasured in cost; premature); leave the on-demand gate unadded since it isn't currently
exploitable via the shipped UI (rejected — "currently safe by UI omission" is explicitly not the same as
architecturally safe, per RISK-017's own framing).

**Why chosen:** Owner ruling — separates the urgent, cheap safety fix (the backend gate) from the expensive,
unmeasured, long-lead-time pipeline work, while keeping the long-term direction on record.

**Risks:** None from adding the gate; the main risk is treating "gate added" as "intraday is ready," which
this decision explicitly forecloses by keeping the vertical-slice RFC as a separate, later, bounded step.

**Migration impact:** The backend gate is additive and closes a latent gap — no behavior change for any
currently-supported request.

**Reversibility:** Fully reversible; the gate can be relaxed once/if the RFC and pipeline work land.

**Tests needed:** A test proving the on-demand path refuses a non-default `tf`, mirroring live-mode's
existing test.

**Date:** 2026-09-04
