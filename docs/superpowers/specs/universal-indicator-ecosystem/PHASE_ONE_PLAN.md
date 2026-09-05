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
| A — Vendor Parity / Semantic Truth | Populate vendor-observation store; initial priority list; real vendor-runtime captures; resolve known Pine ambiguities; vendor-parity as a distinct coverage dimension; CI fixtures; reword benchmark language everywhere | **Not started** |
| B — Known Correctness/Reliability Defects | RISK-016, RISK-012, RISK-022, RISK-024, RISK-025, RISK-017, targeted RISK-015 | **DONE, 2026-09-04.** All seven items fixed and regression-tested (RISK-022's RISK-013 half deliberately deferred to Track F per DEC-006 — see its own row). See `RISK_REGISTER.md` for each fix's detail and test evidence. |
| C — Product Telemetry | 5-event minimum, correlation IDs, using `landing_events`/`signature/ledger.py` | **Not started** |
| D — Production Scan Truth | Resolve RISK-003 to VERIFIED HEALTHY / VERIFIED BROKEN / STILL PRODUCTION-UNVERIFIED | **Not started** |
| E — Complete AI-Door Golden Journeys | Real model-call round-trips for #4/#5 | **Unblocked on the code side** (RISK-016 fixed) — **still blocked on DEC-008's scoped-API-key provisioning**, an owner action this program cannot perform itself |
| F — Imported Parameter Contract ADR | Design doc for Pine input → adjustable UCT input mapping | **Not started** |

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
