# Indicators Phase A0 — Safety and Reliability (report)

**Branch:** `fix/indicators-a0-safety`, from master `1eba7c105c`. Local only: not pushed, merged or deployed.
**Authorised by:** the owner's Phase A0 approval of the decision document (`1a09c5b0ce`).

**Unchanged by A0:**
- No saved formula rewritten.
- No armed alert's firing changed.
- No workspace migration.
- Stateful Pine stays dark.
- Ichimoku untouched.
- No paid AI calls, no production access.

## 1. Root causes and fixes

| # | Problem | Root cause | Fix |
|---|---|---|---|
| 1 | A deeply nested formula returned **HTTP 500** | `save()` hashes the tree with a recursive walker (`stable_stringify`) before the 128-node budget runs. Measured on master: a ~240-deep tree, a 600-long graph chain and 3,500-deep `meta` each raised `RecursionError`, which the router does not catch | An iterative bound at the top of `save()`, before anything recursive (see below). Bodies too deep for the framework to parse already get its own 400 |
| 2 | 68 security rails red since 10-08, proving nothing | Commit `4b9796e968` made `save()` require `definition.version`; fixtures in 4 files never sent it, so each test hit the version refusal before reaching its own guard | Added `version: 1` to the fixture builders, the field every real client sends. **No assertion changed.** The diff adds only that field |
| 3 | Escape census could not run on Windows | The harness `json.dumps`-ed a 4,000-deep corpus tree. CPython's C encoder has a compiled-in recursion budget, lower on Windows (fails at 3,000) | `tools/ast_conformance._dumps_iterative`: an iterative encoder, byte-identical to `json.dumps` (2,000 random payloads tested) |
| 4 | CI recorded **0 vitest tests for 99 runs** while the diff could still read clean | (a) The vitest job's 45-min timeout fell below the suite's wall time (last complete run, 10-03: 2,475 s for 35,702 tests; now ~45k tests). (b) `ci_inventory.diff` judged validity on **pytest only**, so a vitest job with no totals line added no failures | (a) Timeout raised to 100 min, with a note to shard if it nears 80. (b) `diff` now marks INVALID any run whose vitest record is missing, collected 0, or has no totals line. Self-check: 85/85, including 3 new controls |
| 5 | No guaranteed Linux run of the security suite | No job ran the security rails on the production base image | New workflow `indicators security suite`: `python:3.12-slim-bookworm` + Node 20.18.0, no secrets, path-filtered to formula-execution files plus `workflow_dispatch` |
| 6 | Deleting an indicator never flagged its alert | The orphan sweep's walker counted tombstones `{instanceId, deleted:true}` as live instances | Tombstones are skipped. The sweep sets only the existing `instance_missing` disclosure; **firing is unchanged** |
| 7 | Saved-scan subscriptions silently disconnected from edited formulas | Subscriptions are keyed by the hash at subscribe time. Edits move the results' identity, and **semantics 2 suffixes it `~s2` while the UI subscribes with the bare `row.ast_hash`** (finding N11: screen alerts on definitions saved since 2026-10-06 cannot fire) | Read-only detector `api/services/screener/screen_alert_integrity` with reasons `edited`, `semantics` and `deleted`, plus counts-only `summary()`. **Nothing re-keyed or delivered**; the fix belongs to A2 / owner decision O6 |

**Item 1, the two bounds:**
- **`MAX_TREE_DEPTH = 160`**, guard `budget:depth`.
  - A tree's longest path holds that many distinct subtrees, so anything deeper than the 128-node budget is already refused today. The bound refuses nothing new.
  - It also stays well below the depth where recursion overflowed (~240).
  - Graph documents are bounded in one forward pass.
- **`MAX_DOCUMENT_NESTING = 1024`**, guard `tree:nesting`.
  - Applies to the whole document: meta, plots and presentation, not just the tree.
- **Both refusals** come back as a structured 422, and nothing is stored.

**Item 5:**
- One test is deselected by name: the shared screener 402 sentence, which is screener code, filed for its owner.
- The workflow is classified `promotion-gate: no` until it has been observed both failing and passing. That is the repo's own promotion precedent; flipping it to `yes` is the owner's decision.

## 2. Files changed

**Product:**
- `api/services/user_definitions.py`: depth/nesting guard.
- `api/services/indicator_alert_service.py`: tombstone-aware walker.
- `api/services/screener/screen_alert_integrity.py`: new, read-only.

**Tooling and CI:**
- `tools/ast_conformance.py`
- `tools/ci_inventory.py`
- `.github/workflows/full-suite-report.yml`
- `.github/workflows/indicators-security-suite.yml` (new)

**Tests:**
- Repaired fixtures: `tests/test_compute_graph.py`, `test_param_manifest.py`, `test_param_repaste_c46.py`, `test_graph_wire_size.py`.
- New: `test_definition_depth_guard.py`, `test_ast_conformance_payload.py`, `test_alert_deleted_instance_detection.py`, `test_screen_alert_disconnected_detection.py`.

**Docs:**
- `docs/indicators/FINDINGS-FOR-OTHER-OWNERS.md` (§3, §4)
- this report.

## 3. Tests and results

Run on Windows, Python 3.12.10, Node 20. **Baseline** is a clean worktree at the same master commit.

| Suite | A0 | Baseline | Verdict |
|---|---|---|---|
| Security suite, Python (28 files, workflow list) | **1,356 passed, 0 failed**, 5 skipped, 1 deselected | 70 failed, 1,267 passed | All 70 fixed by A0 (68 fixtures + 2 census); **0 new** |
| Security suite, vitest (18 files) | 18/18 files passed | 18/18 | Unchanged |
| Wider regression (user definitions, definition_*, indicator alerts, alert series, alert user, scan definition, screener, starter library, phase E, rev migration) | 29 failed, 2,214 passed | 29 failed, 2,197 passed | **Identical failure set** (0 new, 0 fixed). +17 passes are A0's new tests |
| Depth guard (new) | 17 passed | n/a (new constant) | Before-state measured: `RecursionError` at depth ≥240, at a 600-long graph chain and at 3,500-deep meta |
| Deleted-instance detection (new) | 4 passed | **2 fail, 2 pass** on master | Proves the defect and that the controls hold |
| Screen subscription detection (new) | 11 passed (none skipped, so semantics 2 is live in the store) | n/a (new module) | — |
| `ci_inventory --self-check` | 85/85 ok | — | Includes vitest no-totals and missing-record controls |
| Workflow expression checker | both workflows pass | — | — |
| `test_promotion_gate`, `test_promotion_control` | pass | pass | — |

**The 29 failures shared with baseline:**

| Count | Test file | Cause |
|---|---|---|
| 5 | `test_definition_concierge` | Fixture drift (audit) |
| 4 | `test_starter_library` | Fixture drift (audit) |
| 3 | `test_phase_e_acceptance` | `~s2` lookup |
| 16 | screener filter / column / analyst / earnings-date tests | Screener data, not formula code |
| 1 | `test_user_definitions_auth` | Shared 402 sentence (finding §3) |

**Other baseline failures found:** `test_tools_pin_the_root` also fails on clean master (`market_intel_review.py`, unrelated).

**Not run here:** the Linux job itself. It needs a push or a `workflow_dispatch`, and neither is authorised. Expected on Linux: the same 0 failures, because the 2 Windows-only census tests already pass on Linux CI (run 38334654786).

## 4. Remaining risks

- **The Linux job has never run.** Its container setup (Node tarball download) is unproven until the first dispatch. If it fails on setup, that is a CI-config issue, not a product one.
- **The vitest timeout is now 100 minutes.** If the suite keeps growing, sharding is the durable fix.
- **The full-suite gate will now report INVALID honestly** for any run where vitest doesn't finish. Expect it to turn red rather than "clean" until a run completes within 100 minutes. That is intended.
- **New refusal names.** Trees deeper than 160 levels (already over the node budget) now get `budget:depth` instead of a 500, or `budget:nodes` in the 161–~230 range. They are named refusals either way.
- **Finding N11 is live in production:** screen alerts on semantics-2 definitions don't fire. Detected, not fixed, by design.

## 5. Deployment and rollback (when authorised)

- **Services rebuilt:** an `api/**` change rebuilds web, worker and bars-api.
- **Flow-worker strand:** `tools/flow_worker_watch_coverage.py` names `api/services/indicator_alert_service.py` and `api/services/user_definitions.py`.
  - **Classification: NOT EXERCISED, safe.** The save guard runs only on web's save routes. The orphan sweep runs from web's 5-minute job (`sweep_silent_alerts`). Flow-worker reaches `indicator_alert_service` only through delivery (`claim_delivery`).
  - **Discharge:** the next marker bump in `api/flow_worker_deploy_marker.txt`. #16 is reserved for the alert-coverage RC, so use #16 or #17 depending on which ships first. Land it outside market hours.
- **Gates:** run `tools/pre_push_guard.py` at push time from a Railway-linked checkout.
- **Rollback:** revert the commit. There is no data migration and nothing stored changes shape.
  - Reverting the orphan-sweep fix leaves some alerts flagged `instance_missing`. The next sweep on old code would clear them, since old code counts tombstones as live.
  - The workflow and CI edits revert cleanly.

## 6. A1 / A2 integration plan

The full plans are on the audit branch:
- `docs/indicators/audit-2026-10-13/phase-a/A1-IMPLEMENTATION-PLAN.md`
- `docs/indicators/audit-2026-10-13/phase-a/A2-IMPLEMENTATION-PLAN.md`

**Merge order:** A0 → (A1 ∥ A2a STOC) → A2b thinkScript (after D12/D13) → `C:/w/rpw` rebases onto A2b → A3.

**File boundaries:**

| From | To | Boundary |
|---|---|---|
| A0 | A1 | No shared files. A1 touches no backend or A0 file |
| A0 | A2 | Different hunks in `user_definitions.py`. A2 reuses `screen_alert_integrity` as its re-keying check |
| A1 | A2 | Small textual overlap: `ChartSettingsIndicators.jsx`, `nativeRegistry.js`, `useUserDefinitions.js` |
| A1 | drawing session | Ctrl+Z via a capture listener only while the undo toast shows; drawing code untouched |
| A1 | Agent sessions | A1 shares the Agent's undo record shape (`builder/agentMutations.js`) without editing it. Also: the Agent's `chart.resetDefaults` drops `header.infoValues` (C5) |
| A2 | `uie7` | No shared files |
| A2 | `rpw` | A2b lands first. rpw registers its `note-carried` code explicitly |

**Findings from the plans that affect scope:**
- **A1 C3:** a `?state=` share link rewrites *every* chart widget on the page, and again on every reload.
- **A2:** nothing writes `meta.repaintAck`. So the faithful thinkScript `tf_live` option (D12) would block alert arming entirely. The plan recommends `tf` plus a disclosure.

## 7. Decisions still needed

**For A0 itself:**
- **Authorise the push.** This includes running the new Linux job and the marker bump.
- **Choose when to make the security workflow gating** (`promotion-gate: yes`): after its first observed pass and fail.

**For A1:** Q1–Q6, listed in the A1 plan.

**For A2:**
- D9–D14, D25 and D27;
- O1–O8 from the A2 plan, in particular O6: fix N11, which turns on alerts that have been silent since 10-06.
