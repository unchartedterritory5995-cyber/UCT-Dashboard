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
| A — Vendor Parity / Semantic Truth | Populate vendor-observation store; initial priority list; real vendor-runtime captures; resolve known Pine ambiguities; vendor-parity as a distinct coverage dimension; CI fixtures; reword benchmark language everywhere | **READY FOR OWNER CAPTURE, 2026-09-05 (third pass) per owner/ChatGPT review — use `OWNER_VENDOR_CAPTURE_PACKET_V3_1.md`. V1/V2/V3 are all superseded (each marked at its own top) — do not run any of their scripts.** V3's `median_candLower` formula was checked only against its one planted probe ordering and was WRONG in general (a real permutation/duplicate/random property test — run for V3.1, not for V3 — found it wrong on 8/24 permutations, all 14 tested duplicate cases, and ~31% of 2000 random trials). V3.1 replaces it with a formula proven order-independent by that same property test (0 failures), committed as `verify_oracle_ambiguity_v3_1.py` alongside the historical `verify_oracle_ambiguity_v3.py` (marked superseded at its own top, kept as the record of the mistake). Also closed this pass: `tools/vendor_truth.py` previously CRASHED (`TableRefusal: not a canonical node got None`) the instant a pre-implementation observation (`engine.ast: null` — exactly what every `ta.rising`/`ta.bbw`/`ta.percentrank`/`ta.median` capture needs) existed in the store; it's now patched to skip such observations from comparison, name them separately, and refuse (not quietly pass) if NOTHING held is parity-comparable — closing a RISK-018-shaped conflation risk before any real observation is written. `tests/test_vendor_truth.py`: 22/22 passing (16 before this pass, +6 new). **Blocked only on the owner's TradingView login.** Resumes the moment the owner sends back the V3.1 packet's capture — do not ask for V1, V2, or V3. |
| B — Known Correctness/Reliability Defects | RISK-016, RISK-012, RISK-022, RISK-024, RISK-025, RISK-017, targeted RISK-015 | **DONE, 2026-09-04.** All seven items fixed and regression-tested (RISK-022's RISK-013 half deliberately deferred to Track F per DEC-006 — see its own row). See `RISK_REGISTER.md` for each fix's detail and test evidence. |
| C — Product Telemetry | 5-event minimum, correlation IDs, using `landing_events`/`signature/ledger.py` | **CLOSED, 2026-09-04.** All five events wired end-to-end (`import_submitted`, `compile_finished`, `import_accepted`, `delivery_configured`, `execution_finished`), extending `landing_events` — no new analytics platform. Shared `import_id` threads client → server for full-journey reconstruction. De-dup guard verified non-vacuous. **Hardened same day per owner review**: the initial 200-char length-only guard was replaced with `EVENT_SCHEMAS` — an explicit, named per-event property allowlist (5 separate schemas) enforced through one shared function so the lenient server path and the strict client-HTTP path can never disagree; closes the unlisted-short-value, nested-container, and bool/numeric-confusion bypasses; length now defense-in-depth only. 58 total tests (28+10 original + 20 hardening), all green; adjacent regression sweep re-confirmed 407 passed/6 expected-skipped. See `RISK_REGISTER.md` RISK-023 and `TRACK_C_TELEMETRY.md`'s "Content-safety hardening" section for full detail. |
| D — Production Scan Truth | Resolve RISK-003 to VERIFIED HEALTHY / VERIFIED BROKEN / STILL PRODUCTION-UNVERIFIED | **RESOLVED 2026-09-05 (third pass): VERIFIED HEALTHY.** The second pass (2026-09-04) hit a tool-level wall from an isolated-worktree fork (blanket `railway ssh` script-complexity refusal + a PTY-hang workaround); the third pass ran the identical prepared probe from the main repo checkout with Railway confirmed linked (`railway status` → `luminous-recreation`/`production`/`web`) and it worked cleanly. Evidence: `scan_coverage`'s `MAX(as_of)=20260904` across 4 independent scan definitions, each evaluating the full 3,742-ticker universe, with a gap-free run of prior sessions and non-zero `scan_hits` through the same date; the probe ran on Saturday 2026-09-05, so Friday 2026-09-04 is the most recent possible trading-session close — `MAX(as_of)` matches it exactly. Packaged for repeatability as `tools/track_d_risk003_probe.py` (tested). See `RISK_REGISTER.md` RISK-003 for the full evidence trail across all three passes. |
| E — Complete AI-Door Golden Journeys | Real model-call round-trips for #4/#5 | **Ready to run, 2026-09-04** (`GOLDEN_JOURNEY_04_05_READY_TO_RUN.md`) — isolated-env plan, exact prompts/fixtures (`tests/fixtures/golden_journey/`), a fully-wired test module (`tests/test_golden_journey_04_05_live.py`; verified today: `1 passed, 6 skipped`, the one always-runnable case green, every key-gated case skipping loudly and by name, never silently), negative/ambiguity cases, persistence + scan-delivery checks, and the evidence-capture plan are all done with **no key used**. **Only remaining blocker is DEC-008's scoped-API-key provisioning** (+ `INDICATOR_VISION_ENABLED=1` for #5), an owner action this program cannot perform itself — the instant it exists, one `pytest` command executes everything. |
| F — Imported Parameter Contract ADR | Design doc for Pine input → adjustable UCT input mapping | **CLOSED FOR NARROW V1, 2026-09-05 — this row was stale until this correction (flagged during the 2026-09-05 session recovery; two independent read passes caught it).** ADR chain (`TRACK_F_PARAMETER_ADR_V2.md` → `_V2_1.md` → `_V2_2.md`) was accepted; the falsified design correction ("no server-side reparse of `compute.source` — trusted `astPath` traversal of `compute.ast`/`compute.trees` instead") is recorded in the ADR and in `DECISIONS.md` DEC-006's status update. The **15-point spike ran and passed 21/21** (`tests/test_param_manifest.py`, promoted from `param_manifest_spike.py` in commit `dc370f57c`), with `test_user_definitions.py` (46) and `test_vendor_truth.py` (22) unaffected. Owner then authorized and Claude shipped **narrow v1** — `input.int`/`input.float` only — end to end: translator support, `pineParamManifest.js`, `ParamControls.jsx`, BuilderSheet/PineBox integration, server-side trusted-manifest enforcement. Verified live: RSI fixture 14→21, DB write/reload, out-of-range rejection, 14/14 corpus scripts gained ≥1 adjustable parameter (29 total), zero change to translation coverage; a real bug (`foldWindow` silently dropping a parameter tag on a no-op fold) was found and fixed. A same-day follow-up verified the reopen/re-tune path live (PUT not POST, version increment, immutable default preserved) with a permanent regression (1616 passed, 2 pre-existing unrelated failures). **RISK-013 = PARTIALLY CLOSED** — closed for `input.int`/`input.float`; explicitly still open for `input.bool`/`string`/`source`/`timeframe`/`symbol`/`time`/`color`, switch-driving inputs, numeric `options` enums, and bar-displacement cases. **No further Track F expansion is authorized without the next owner/ChatGPT review (Review Packet #2).** Full detail: `TRACK_F_SPIKE_REPORT_V1.md`, `TRACK_F_V1_IMPLEMENTATION_COMPLETION_REPORT.md`. |

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
