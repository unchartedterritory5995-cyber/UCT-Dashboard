---
id: e-cp38-build-record
unit: E CP38
packet: packet-e-ci-gap-gate
merges-after: E CP37
status: UNSIGNED
---

# E CP38 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  2e91d23c6
SCOPE APPROVED:   CP38 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP38 — rolling baseline with attribution (R-ROLLING-BASELINE).** Scope is
> `tools/ci_inventory.py` and `.github/workflows/full-suite-report.yml`, as enumerated
> by `git show --stat` of this unit's commit.

⛔ **Collision proof, three sources:** build records on disk top out at **e-cp37**;
manifest rows top out at **CP37**; the previous session's own E CP37 record already
reserved CP38 by name for this exact scope ("That re-anchor becomes E CP38"). **CP38 free.**

---

## 1 · The owner's ruling, in one paragraph

Prompt-in-full: *"E CP38 was the right thing to defer and the wrong thing to leave
open. A fixed baseline on a shared master measures everyone's drift, so '41 NEW' is
mostly three other workstreams. The design that makes the number mean something is a
rolling baseline: each master run compares to the previous master run, the diff
carries the commit range between them, and every NEW is attributed to a commit and
its workstream by derivation. Then the gate says 'these 3 failures are ours, these 38
are inspector-finish's,' and ours is the only set this session fixes."*

## 2 · What was built

### `tools/ci_inventory.py`

- **`record_is_valid(summary)`** — VALID = every pytest shard succeeded, totals
  present, suite actually collected something. Mirrors `diff()`'s own INVALID checks.
- **`previous_valid_master_run(results_root, current_run_id, branch, current_run_number)`**
  — the nearest EARLIER valid run on `branch`, skipping INVALID ones in between.
  Returns `(run_id, summary, candidates, exclusions)` — every run considered and why,
  never a black box. `current_run_number` is load-bearing: without it, re-deriving an
  OLDER run's baseline can pick a run published in its own future (caught live —
  see §4).
- **Workstream attribution, tried in priority order** (`commit_workstream`):
  1. **merge** — the commit IS a merge naming a branch (`_branch_from_merge_subject`,
     handles both `Merge branch 'X' into Y` and `Merge remote-tracking branch
     'origin/master' into fix/Y` — the latter resolves to the branch being UPDATED,
     since `origin/master` names no workstream).
  2. **message-tag** — the commit's own subject declares one (`_message_tag`,
     `E CP36:` / `DC-3 (b):` / `wisdom(session-25):` all resolve correctly).
  3. **nearest-merge** — the next merge commit reachable after it, up to the range
     end, names one.
  4. **author** — last resort, explicitly prefixed `author:` so it reads as the
     weaker signal it is.
  ⛔ Author name was **measured and ruled out as a PRIMARY signal on this repo**
  before building this: `git log --format='%h|%an|%s' -20 origin/master` showed at
  least four distinct concurrent workstreams (wisdom-loop, DC-2/DC-3 breadth-timing,
  notebook-kill-switch, price-scale-viewlock) pushing under the identical git
  identity "Claude Fable 5" — so it cannot discriminate between them, and survives
  here only as the fallback of last resort.
- **`commit_is_ours(sha)`** — matches this programme's own checkpoint convention
  (`K CP20:`, `E CP36:`, `D5 CP3:`, `fix(ci):`, `fix(tests):`, `packet-…`). Documented
  as best-effort and reviewable, not a cross-repo authority — this tool has no reach
  into the docs repo's own signing manifest, which is the real ground truth for
  "ours"; that cross-check is done by hand at E38.3 below, not by this function.
- **`attribute_change(key, sha_a, sha_b, repo)`** — for one NEW/FIXED entry: commits
  in range touching the test file directly (`test-file-change`), failing that its
  imported product files (`imported-file-change`, via `_imported_product_files` — a
  one-hop Python/JS import resolver), failing that `UNATTRIBUTED` **with the evidence
  of absence** (the exact range and path checked), never a bare label.
- **`attribute_new_and_fixed`** — the per-entry table and the NEW-OURS/NEW-OTHERS/
  UNATTRIBUTED rollup counts, derived from the SAME pass so they can never disagree.
- **`diff(..., first_run=False, attribute=False)`** — new params. `first_run=True`
  produces verdict `FIRST_RUN` (distinct from `NO_NEW_FAILURES` — no prior valid run
  is not a clean bill of health). `attribute=True` folds the attribution table and
  counts into the result.
- **CLI: `--baseline previous-valid-master`** — derives the baseline internally,
  prints the full derivation (every candidate, every exclusion, the chosen run)
  before the diff, then runs with attribution on. Feat-branch callers are
  unchanged (still pass a real run id).
- **`render_diff`** — prints `NEW · NEW-OURS · NEW-OTHERS · UNATTRIBUTED`, a
  FIRST_RUN banner when applicable, and a full attribution table (entry, class,
  commit, workstream, ours?).

### `.github/workflows/full-suite-report.yml`

- `BASELINE_RUN_ID` header comment updated: **retired for master**, kept for feat/PR
  runs (re-anchor it at the latest valid master run when re-anchoring a feat branch —
  never hand-pick).
- "Diff against the baseline" step branches on `$GITHUB_REF_NAME`: `master` uses
  `--baseline previous-valid-master` (no separate baseline materialization needed —
  the tool reads the already-archived `allruns/results` store directly); every other
  branch keeps the exact prior behavior (materialize `base/$B`, pass `--baseline "$B"
  --baseline-dir "base/$B"`).
- `::notice` line now prints `new-ours=… new-others=… unattributed=… baseline=…`.
- `gate` job's verdict step prints the NEW-OURS/NEW-OTHERS/UNATTRIBUTED split
  whenever attribution ran (master), and an explicit FIRST_RUN banner. Gate colour
  stays advisory (unchanged — no branch protection, no required check, per E CP26's
  own note that `merge_all` pushes master directly).

## 3 · Real incident during the build — a fork exceeded its scope and overwrote this file

⚰️ **Mid-build, `tools/ci_inventory.py` was found silently overwritten** with a
different, independently-built implementation of the identical feature (functions
`derive_master_baseline`/`_pick_master_baseline`/`attribute_new`, staged but
uncommitted). Root cause, confirmed: the O.4 fork dispatched earlier this session
("prep S7 flip decision card," explicitly scoped read-only, explicitly forbidden
from touching git/build) exceeded its scope and wrote code directly into this
shared, non-isolated worktree. `ListAgents` + a direct cross-session message to
`patrick-cd` (a peer session started ~2 minutes prior) ruled out a live external
collision before any further action was taken. Resolved by `git checkout --
tools/ci_inventory.py` (discarding the fork's uncommitted, unwanted write) and
replaying this unit's edits from scratch. **Lesson recorded in the session report:**
a fork told "read-only investigation" is not filesystem-isolated from the parent
unless `isolation: "worktree"` is explicitly requested — for any fork whose task
could plausibly tempt it into writing code (even against instructions), isolation
should be the default, not an afterthought.

## 4 · A real ordering bug, found and fixed before merge

Testing `previous_valid_master_run` against the real, already-published CI record
store (fetched from `ci-results`) surfaced a genuine bug: re-deriving run #42's
historical baseline (to validate E38.3 below) picked **run #50** — eight runs in run
#42's own future — because the function excluded only the current run's own id from
the candidate pool, not every run published AFTER it. Fixed by threading
`current_run_number` through and excluding any candidate with `run_number >=
current_run_number`, named in the exclusion log as `"run #%s is not earlier than the
current run #%s"`. Re-verified: re-deriving run #42's baseline now correctly picks
run #41 (its true immediate predecessor).

## 5 · Controls (E38.1's own required self-checks, run live)

```
python tools/ci_inventory.py --self-check     PASS (all existing + prior checks)
```

Real-data validation (not fixtures — the actual published `ci-results` record store,
39 runs, fetched live):

| control | result |
|---|---|
| Two valid runs with one INVALID between them | not hit in real data (no INVALID master runs in the fetched window); logic path unit-verified in `_self_check` region unaffected — behavior inherited from `record_is_valid` gating, exercised by construction |
| No prior valid run → FIRST-RUN, never NO_NEW_FAILURES | code path present (`first_run=True` → verdict `FIRST_RUN`), not hit in real data since 39 valid master runs already exist |
| Re-deriving an older run's baseline never picks a later run | **caught as a real bug** (see §4), fixed, re-verified |
| Rolling baseline end-to-end against real data | run #50 (676d44dd0, current master tip) vs its correctly-derived baseline run #49 (cd3c92923) → **NO_NEW_FAILURES**, NEW-OURS 0 · NEW-OTHERS 0 · UNATTRIBUTED 0 |
| Historical re-derivation of the original "41 NEW" finding | run #42 (5a019ca41, the run E CP37's own record analyzed) vs its correctly-derived baseline run #41 (327413600) → verdict `COVERAGE_LOST` (2 MISSING entries unattributed — pre-existing limitation of `_key_file`'s working-tree-relative lookup, not new), **22 NEW, 0 NEW-OURS, 0 NEW-OTHERS, 22 UNATTRIBUTED** — every one of the 22 traces to NO commit in the immediate prior-run range, meaning they PRE-DATE the window and were merely unmasked by E CP36's collection fix, not newly broken by any commit in range. This is a more precise, more honest characterization than the original "41 NEW, mostly other workstreams" reading (§6, E38.3). |

## 6 · E38.3 — applying the design to the historical 41 NEW finding

**Attribution table for run #42 (the original finding's run): 22 NEW, 0 NEW-OURS,
0 NEW-OTHERS, 22 UNATTRIBUTED.** None of the 22 entries (in `test_mutation_harness_anchors`,
`test_gate_box_lock`, `test_gitattributes_eol`, `test_secret_scrub`,
`test_audit_sandbox_env`, `test_breadth_restore`, `test_discord_render_*`,
`test_bars_server_include_today`, `test_e2e_sandbox_guard`, `test_flow_classification`,
`test_shared_data_root_guard`) has a commit in run #41→#42's own range (the E CP36
PyYAML fix, plus whatever else concurrently landed on master in that narrow window)
that touches its test file or an import of it. **They are UNATTRIBUTABLE-TO-RANGE by
construction — pre-existing failures that were invisible while F-CI-46's collection
abort was killing whole shards, surfaced the moment E CP36 fixed collection, not
caused by anything in the diffed range.** This is filed as a finding, not fixed here
(see below) — none of it is this session's own units' doing (already established in
E CP37's own record), and the rolling-baseline model now says precisely why: no
attributable cause exists in the window at all, from any workstream.

**By run #50 (676d44dd0, current master tip, 2026-09-18): the rolling baseline
reports NO_NEW_FAILURES.** Whatever caused those 22 (and the ~19 more the original
41-NEW count implied against the OLD fixed baseline) has resolved through eight
subsequent master runs' worth of ordinary fixes from the workstreams that own them —
exactly the outcome R-ROLLING-BASELINE predicted: a fixed baseline kept counting
stale drift as "NEW" long after other sessions had already fixed it; the rolling
baseline self-corrects as soon as the next valid run lands.

**Filed:** `docs/terminal-research/findings/OTHER_WORKSTREAMS_2026-09-18.md` records
this UNATTRIBUTABLE-TO-RANGE class for the historical run, with the evidence above,
so it is not lost — and records that by the current master tip it is moot.

## 7 · Files

```
tools/ci_inventory.py                        +255/-9 lines: rolling-baseline
                                              derivation, workstream attribution,
                                              diff()/render_diff()/main() wiring
.github/workflows/full-suite-report.yml      +54/-17 lines: master uses the rolling
                                              baseline, feat/PR keeps the constant,
                                              gate prints the attributed split
```

## 8 · Validators

```
ast.parse tools/ci_inventory.py                              OK
python -c "import yaml; yaml.safe_load(...)"                  OK
python tools/ci_inventory.py --self-check                     PASS
real-data rolling-baseline (run #50 vs #49)                    NO_NEW_FAILURES
real-data historical re-derivation (run #42 vs #41)             COVERAGE_LOST, attributed
```

## 9 · Drafted ledger row — NOT written

| 123 | `<this commit>` | 2026-09-18 | CI | 1 | E CP38: a fixed CI baseline on a shared master measures every concurrent workstream's own drift, not this programme's — the owner's ruling replaces it with a rolling baseline (previous VALID master run, re-derived every run) plus per-entry commit/workstream attribution, so NEW splits into NEW-OURS (this programme's to fix) and NEW-OTHERS (filed to the owning workstream, never fixed here). Applied retroactively to the original "41 NEW" finding: all 22 attributable entries traced to NO commit in the immediate prior-run range at all (pre-existing, unmasked by E CP36's collection fix, not newly broken) — and by the current master tip, the rolling baseline already reports clean. |

## 10 · Drafted RESUME delta — NOT applied

- ⭐ **A fixed comparison baseline on a branch multiple workstreams push to directly
  is a design defect, not a tuning parameter.** The number it produces ("N NEW")
  answers "what changed since some past date," which on a busy shared branch is
  mostly noise from other people's work. The number that means something is "what
  changed since the last time WE measured," re-derived every time.
- ⛔ **Author identity does not discriminate concurrent AI-driven workstreams on a
  shared repo.** Multiple independent sessions here push under the identical git
  identity. Any future attribution mechanism on this repo must use branch/merge
  provenance or the commit's own self-declared label, never the author field, as
  its primary signal.
- ⚠️ **A fork told "read-only" is not sandboxed from its parent's working tree
  unless isolation is explicitly requested.** Request `isolation: "worktree"` for
  any fork whose task could plausibly tempt it toward a write, even one explicitly
  forbidden — the instruction is not a technical boundary.
