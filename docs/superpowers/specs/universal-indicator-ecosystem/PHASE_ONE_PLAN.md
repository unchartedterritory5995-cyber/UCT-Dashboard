# Phase One — Trust Foundation

Authorized 2026-09-04 by external owner/ChatGPT review of `CHATGPT_REVIEW_PACKET_01.md` (see DEC-003).
**Read this file's status table before trusting any track description below — it will go stale, per this
program's own Stale Documentation Principle (`RISK_REGISTER.md`).**

**Objective:** turn a sophisticated, largely-working existing system into one whose semantic correctness,
operational reliability, observability, and real product behavior are sufficiently demonstrated to support
the larger UCT universal-indicator objective. **Not an architecture rewrite** — DEC-003 preserves the
canonical AST, single-write-door model, dual execution kernels, manifest-driven static analysis, existing
screener integration, and five-door architecture.

## Owner decisions governing this phase (full detail: `DECISIONS.md` DEC-004 through DEC-010)

| Q | Topic | Ruling | DEC |
|---|---|---|---|
| 1 | Confluence | Conditional retirement of `dpc-v1`; never rename the shipped Confluence Radar | DEC-004 |
| 2 | Toolkit tiering | Deferred; current entitlements preserved; telemetry informs it later | DEC-005 |
| 3 | Pine input fidelity | Pursue, contract-first (ADR before implementation) | DEC-006 |
| 4 | Vendor observations | Standing discipline, not a one-time backfill; named Vendor Parity Owner role | DEC-007 |
| 5 | Scoped Anthropic key | Approved, conditional on RISK-016 fixed + regression-tested first | DEC-008 |
| 6 | `patterns-retire` worktree | Inspect diff, verify ownership, don't merge blindly — routing note, see below | — |
| 7 | `indicator-endzone` session | Resolve via process evidence; never disturb an active external session | — |
| 8 | CLAUDE.md | Fix the specific stale references now; no broad rewrite | — |
| 9 | `SCAN_LIVE_SWEEP_ENABLED` | Not armed yet; 5-gate staged canary required first | DEC-009 |
| 10 | True intraday scanning | Long-term yes; not this phase; immediate backend gate required now | DEC-010 |

**Q6/Q7/Q8 routing** (operational, not architectural — folded into `RISK_REGISTER.md` rather than new DEC
entries): RISK-008 (`patterns-retire`) gets an owner-ruling note: inspect the exact diff, identify ownership,
reproduce and independently validate before routing through the pattern-engine project; not a Phase One
blocker unless it touches shared infrastructure. RISK-006 (`indicator-endzone`): resolve via process/
worktree evidence where possible; continue Phase One in this isolated worktree regardless; not a blocker
unless the same files are actively being modified elsewhere. RISK-015 (CLAUDE.md): fix the two specific
stale references now as a small documentation-safety task; add/retain explicit source-of-truth precedence
language (current executable code/runtime/test evidence > stale narrative documentation); no broader
doc-hygiene rewrite in this phase.

## Open owner/policy decision — `SCAN_HITS_RETENTION_DAYS` (surfaced 2026-09-04)

**Not yet a DEC. Verified, not settled.** RISK-024's fix (Track B) wired a real prune job for
`scan_hits`/`scan_coverage`, defaulting to 120 days. On owner request, I verified whether 120 was
already an authoritative number (existing code/config/design doc) or newly chosen during the fix.
**It was newly chosen** — borrowed from `pattern_engine.memory.PRUNE_RETENTION_DAYS`'s default for
its *shape* only (an env-overridable retention constant). Its own 120 turns out to be justified by
something specific to pattern-outcome tracking (a 90-day resolution lookback + 30-day aggregation
margin) with no bearing on scan_hits. No design doc, requirements ledger, or prior config specifies
a scan_hits-specific retention window, and the constant did not exist before this fix (confirmed via
`git log` — introduced fresh in `9e8e1446e`). **The mechanism is sound and independent of the number**:
`SCAN_HITS_RETENTION_DAYS` is env-overridable on Railway with no code change. **Action for the owner**:
decide the real retention window (member-facing consideration: how far back would a member reasonably
want to see "what my saved screen matched on date X"; operational consideration: table growth rate,
not yet measured for `scan_hits` specifically the way `pattern_detections`' 13.57 GB/1.54M-row-in-six-
weeks incident was measured for that table). Until ruled, 120 stays as the running default — replacing
one unvalidated guess with another equally unvalidated guess would not improve anything ahead of a real
decision. See `RISK_REGISTER.md` RISK-024 for full detail.

## A documentation wording correction (owner-flagged, not a new finding)

The owner flagged an apparent contradiction in permanent documentation: one section says "nightly-only
scanning is confirmed product policy" while `DATA_EXECUTION_FINDINGS.md` establishes that going beyond
nightly was already owner-approved, Run Now already ships, and a continuous forming-daily-bar sweep exists
behind a dormant flag. **This is not actually a contradiction** — `CHATGPT_REVIEW_PACKET_01.md` §15's exact
wording is "nightly-only scanning is confirmed product policy" in reference to the **scheduled full-universe
baseline sweep** specifically (bucket 1/2 of the six-bucket breakdown in §10), not a claim that no other
execution policy exists. The distinction to state explicitly, everywhere this comes up: **scheduled
full-universe baseline sweep = nightly** (bucket 1, an execution-engine limitation; bucket 2, a closed
policy question) **while on-demand ("Run Now," bucket 4, shipped) and future live/intraday execution
(bucket 3, dormant; bucket 5, unbuilt) are separate execution policies layered on top of, not
contradicting, the nightly baseline.** Action: reword §15 of `CHATGPT_REVIEW_PACKET_01.md` (or annotate it)
to say "the *scheduled full-universe baseline* sweep is nightly-only, confirmed product policy" rather than
the shorter, ambiguous phrase — done below in this file's own restatement, with the original packet left as
a historical record per this program's append-only-correction convention rather than edited after the fact.

## Track status

| Track | Scope | Status |
|---|---|---|
| A — Vendor Parity / Semantic Truth | Populate vendor-observation store; initial priority list; real vendor-runtime captures; resolve known Pine ambiguities; vendor-parity as a distinct coverage dimension; CI fixtures; reword benchmark language everywhere | **REVISED 2026-09-05 per owner/ChatGPT review — use `OWNER_VENDOR_CAPTURE_PACKET_V2.md`, NOT the V1 packet (superseded, do not run its steps).** V1's reads depended on "the Nth bar from the start of history," not reproducible across accounts. V2 is ambiguity-first: ONE deterministic, self-locating Pine oracle script settling the four functions this repo's own prior research (`968209bfe`, `0950cff9f`, both 2026-09-03) already found are both genuinely ambiguous in TradingView's own documentation AND measurably the leading blockers of real blind-corpus Pine coverage (`ta.rising`, `ta.bbw`, `ta.percentrank`, even-length `ta.median` — all four already refused by name in `closedTable.json::_functions_excluded`, none yet implemented). Uses a `bar_index`-driven synthetic 25-bar repeating pattern with a plotted `phase` locator (0-24, repeating forever) so the probe row is findable regardless of how much history loaded — no dependency on "the first bar." One export (or a 10-value Data-Window fallback) settles all four. `VENDOR_CAPTURE_PLAN.md`'s prioritized-function-list/tooling-verification work stands unchanged; Tranche 1B (the original real-price RSI/ATR/Stoch/Aroon/HMA script) is retained as an explicitly optional, lower-priority follow-on, never ahead of the four-ambiguity ask. **Blocked only on the owner's TradingView login**, same capability wall as before. Resumes the moment the owner sends back the V2 packet's capture. |
| B — Known Correctness/Reliability Defects | RISK-016, RISK-012, RISK-022, RISK-024, RISK-025, RISK-017, targeted RISK-015 | **DONE, 2026-09-04.** All seven items fixed and regression-tested (RISK-022's RISK-013 half deliberately deferred to Track F per DEC-006 — see its own row). See `RISK_REGISTER.md` for each fix's detail and test evidence. |
| C — Product Telemetry | 5-event minimum, correlation IDs, using `landing_events`/`signature/ledger.py` | **CLOSED, 2026-09-04.** All five events wired end-to-end (`import_submitted`, `compile_finished`, `import_accepted`, `delivery_configured`, `execution_finished`), extending `landing_events` — no new analytics platform. Shared `import_id` threads client → server for full-journey reconstruction. De-dup guard verified non-vacuous. **Hardened same day per owner review**: the initial 200-char length-only guard was replaced with `EVENT_SCHEMAS` — an explicit, named per-event property allowlist (5 separate schemas) enforced through one shared function so the lenient server path and the strict client-HTTP path can never disagree; closes the unlisted-short-value, nested-container, and bool/numeric-confusion bypasses; length now defense-in-depth only. 58 total tests (28+10 original + 20 hardening), all green; adjacent regression sweep re-confirmed 407 passed/6 expected-skipped. See `RISK_REGISTER.md` RISK-023 and `TRACK_C_TELEMETRY.md`'s "Content-safety hardening" section for full detail. |
| D — Production Scan Truth | Resolve RISK-003 to VERIFIED HEALTHY / VERIFIED BROKEN / STILL PRODUCTION-UNVERIFIED | **Attempted 2026-09-04 (second pass), classification: STILL PRODUCTION-UNVERIFIED.** Not a data-safety block — a tool-level one: this pass ran from an isolated-worktree fork, which refuses any `railway ssh` command carrying a nontrivial script (blanket policy, not a finding about the query), and a stdin-piped workaround hung on `railway ssh`'s forced PTY allocation. The coordinator independently attempted the same connectivity check from the main session and hit a third, different obstacle (a broken local `railway ssh` path-resolution on this Windows host — "C:/Program: not found"), which further corroborates that the blocker is tooling/environment, not the query's safety. The exact bounded, read-only, `mode=ro` SQLite probe against `scan_coverage`/`scan_hits` is fully prepared and safety-reviewed in `CURRENT_ARCHITECTURE.md`. **Next step: run it from a non-isolated session or by a human with working terminal/SSH access** — likely resolves this in one command once outside these specific tool restrictions. See `RISK_REGISTER.md` RISK-003 for full evidence. |
| E — Complete AI-Door Golden Journeys | Real model-call round-trips for #4/#5 | **Ready to run, 2026-09-04** (`GOLDEN_JOURNEY_04_05_READY_TO_RUN.md`) — isolated-env plan, exact prompts/fixtures (`tests/fixtures/golden_journey/`), a fully-wired test module (`tests/test_golden_journey_04_05_live.py`; verified today: `1 passed, 6 skipped`, the one always-runnable case green, every key-gated case skipping loudly and by name, never silently), negative/ambiguity cases, persistence + scan-delivery checks, and the evidence-capture plan are all done with **no key used**. **Only remaining blocker is DEC-008's scoped-API-key provisioning** (+ `INDICATOR_VISION_ENABLED=1` for #5), an owner action this program cannot perform itself — the instant it exists, one `pytest` command executes everything. |
| F — Imported Parameter Contract ADR | Design doc for Pine input → adjustable UCT input mapping | **REVISED 2026-09-05 per owner/ChatGPT review — use `TRACK_F_PARAMETER_ADR_V2.md`** (v1 superseded, marked at its own top, kept as historical record). v1's §3.10 proposed persisting the original Pine source text to enable re-translation, silently reopening Phase Zero's "raw source is transient, never persisted" boundary. V2 resolves this: `compute.source` (the UCT-DSL text every saved definition already persists, verified directly against `user_definitions.py`'s schema and `validate_v2()`) is reused as the re-translation substrate instead — the translator emits a named `let <name> = <value>` binding for each adjustable-eligible input instead of inlining its literal, so a parameter override is a single, unambiguous, human-legible text location, never raw vendor source and never a novel provenance format. Alternative C (raw source persistence) evaluated in full per the owner's checklist and explicitly rejected as unnecessary. v1 scope narrowed further: `input.string`'s "plain literal" carve-out is dropped — deferred in its entirety, no special case. Out-of-range overrides: REJECT, never clamp (firm recommendation, 4 new tests specified). §6 traces the actual definition/alert/scan reference model directly against code rather than assuming: `def_id` is stable across edits (a real, already-shipped `PUT /{def_id}` path `BuilderSheet` already uses), `alert_user_series.forget()` fires on every save forcing full re-proof (and a real historical bug in this exact area — a rebuild re-cached without re-proof — is already fixed and tested, `test_user_definition_reproof.py`), and `scan_evaluator` reads definitions fresh every cycle keyed by `def_hash` with no stale-serving path found. No broad implementation until V2 is accepted; §3.2 of V2 names the `let`-emission verification as implementation's own first task. |

**Sequencing note**: Track B is complete. Track E's code-side blocker (RISK-016) is resolved; it now waits
only on the owner provisioning the scoped, isolated-environment-only Anthropic API key DEC-008 approved.
Track A is called the "highest strategic correctness priority" by the owner but requires careful, evidence-
quality-conscious manual work (real vendor-platform observation), not bulk automation — paced accordingly,
not rushed.

**A pre-existing, unrelated flake noticed while running Track B's regression suites** (not a Track B
finding, not investigated further, recorded so a future session doesn't rediscover it from scratch):
`ImportBox.thinkscript.test.jsx`'s `'import-suggest-apply'` case fails intermittently on a whitespace/line-
ending mismatch in a pasted-text comparison. Confirmed via `git log`/`git diff` that no commit in this
Track B tranche touches `ImportBox.jsx` or its test file — pre-existing, out of this track's scope.

## Pattern-engine scope boundary (owner-flagged)

The remaining ~90-detector RISK-021 sweep is explicitly **not** a central Phase One workstream unless
shared-infrastructure evidence requires it. Cross-link to the existing pattern-engine reliability effort;
this project does not silently absorb every adjacent UCT analytical subsystem.

## Release / Human-QA readiness gate

Not recommending broad paid human acceptance testing yet. Target, before the next readiness review:

1. All five doors completed through at least one real E2E Golden Journey (Track E closes #4/#5).
2. Core vendor-observation store populated (Track A's initial tranche).
3. No known critical silent semantic wrong-answer defect.
4. RISK-016/RISK-012-class member-facing defects fixed with regressions (Track B).
5. Five-event telemetry operating (Track C).
6. Existing Screener/Saved-Screen preservation checks green.
7. RISK-003 resolved or precisely isolated (Track D).
8. Critical browser journey suite automated.
9. Validation Coverage Map updated.

At that point, produce a **Human Testing Readiness Report** recommending NOT READY / READY FOR LIMITED
HUMAN QA / READY FOR BROAD HUMAN ACCEPTANCE TESTING.

## Next review checkpoint — ChatGPT Review Packet #2

Stop for owner/ChatGPT review after the initial vendor-parity tranche, the known-defect tranche, telemetry,
a RISK-003 resolution attempt, and completion of Golden Journeys #4/#5 have landed — not after every Phase
One feature imaginable. Packet #2 must include: (1) Phase One changes, (2) vendor observations captured,
(3) vendor parity results, (4) correctness discrepancies discovered, (5) defects fixed, (6) regression tests
added, (7) telemetry now available, (8) AI-door E2E results, (9) production scan verification, (10) updated
Validation Coverage Map, (11) remaining risks, (12) imported-parameter ADR recommendation, (13) intraday
vertical-slice recommendation, (14) human-testing readiness state, (15) proposed next build phase, (16)
owner decisions required.

**No global live-sweep enablement, broad intraday rollout, major architecture replacement, or paid broad-
human-QA recommendation before that review.**
