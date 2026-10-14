# Gate C — release checklist (prepared 2026-10-13 late ET, new PC)

> **Gate C is NOT authorized for release.** Nothing below may start until the owner says so explicitly.
>
> **Owner (2026-10-13 ~23:58 ET):** the new-PC UCT Agent session (`agent-5f`) is the **sole owner** of Gate C release preparation and eventual execution. Neither INDICATORS nor any other Agent session (e.g. `agent-d7`) releases Gate C. Sequence: **A0 → Gate C → A1**, each with its own separate owner authorization.
> This checklist replaces the handoff's baseline (`b445c85440` / `b80e0bf818`) with SHAs measured on 2026-10-14 ~03:30Z.
> Every SHA is a dated claim: re-measure at release time (step 1).

## 0. State measured at preparation

| | SHA | How measured |
|---|---|---|
| `origin/master` | `558c6443f1` | `git fetch origin` then `git rev-parse` |
| `origin/production` | `d2a7b4822c` | same; an ancestor of master; master is 1 docs commit ahead |
| Gate C RC | `3191545b71` | `handoff/agent-gate-c-2026-10-13~1`; 6 commits, 39 files, base `b445c85440` |
| master drift since the RC base | 71 commits | `git rev-list --count $(merge-base origin/master RC)..origin/master` |
| Indicators A0 | `b8da8233f7` (`origin/release/indicators-a0`, draft #322) | not merged |
| Indicators A1 | `2928cfc55e` (`origin/feat/indicators-a1`, draft #325) | not merged; frozen per INDICATORS |

Overlap and merge checks (`git merge-tree --write-tree`, exit code read directly):

| Check | Result |
|---|---|
| Gate C files ∩ master changes since the RC base | 0 |
| Gate C ∩ A0 | 0 (A0 is 19 files, none under `app/src`) |
| Gate C ∩ A1 | 2: `chart/builder/agentMutations.js`, `chart/engine/__tests__/controlDoorCensus.test.js` |
| merge-tree Gate C → master / A1 → master / A0 → master / Gate C → A1 | all clean (rc 0) |

The Gate C footprint outside `app/src/agent/**` and `docs/**`:
- `api/services/uct_agent/turn.py`: +1 line (the `conversation_memory` instruction);
- `agentMutations.js` + `agentMutations.inputs.test.js` (`setInputs`, approved by INDICATORS);
- one `controlDoorCensus.test.js` row.

It does **not** touch `budget.py`, `limits.py`, `api/routers/uct_agent.py` (`require_admin_dark`) or any schema, env var or stored preference.

## 1. Preconditions (all must hold; each is a stop if not)

- [ ] **Owner's explicit Gate C release approval**, recorded with its date.
- [x] **Gate B production smoke done by the owner**, then recorded (counts only) in `GATE-B-PRODUCTION-RECORD.md`. **Done 2026-10-13 ET, PASS** (`models` also lists `perplexity`: the research row of a sourced answer, by design; see the record):
  - `cap_usd 5`;
  - `calls.settled ≥ 1`;
  - tokens > 0;
  - `models ["claude-haiku-4-5"]`;
  - `site.cap_usd 15`.
- [ ] **Landing order agreed.** Owner (2026-10-13): **A0, then Gate C, then A1**. INDICATORS (`indicators-65`, 2026-10-13) agrees technically and will confirm with the owner directly. A0 lands only on the owner's own release authorization, after-hours (marker #17), by INDICATORS. A1 lands third: it rebases onto master + A0 + Gate C and re-runs the A1 integration tests. **Frozen on both sides until A1 lands:** `agentMutations.js`, `controlDoorCensus.test.js`, `engine/settingsRecord.js`, `builder/settingsRecordParity.test.js`, `indicatorHistoryStore.js` (+ test), `chart/pane/ChartPane.jsx`, `widgets/ChartWidget.jsx`, `pages/charts/ChartsWorkspace.jsx`. The owner restated the sequence 2026-10-13; INDICATORS agreed and was told of the sole-ownership ruling. Tick at release time, once A0 has landed on its own authorization.
- [x] **Railway CLI** installed, logged in and linked in this worktree. `railway status --json` names the project and services. (2026-10-13: CLI 5.68.0; project `luminous-recreation`, environment `production`, 9 services all SUCCESS. Re-read at release.)
- [ ] **Not in the deploy freeze.** `.venv\Scripts\python.exe tools/deploy_freeze.py` exits 0 (the freeze is Wednesday 09:00–11:00 ET). ⛔ Use the **venv** Python: this PC's system Python has no `tzdata`, so the tool **fails open** there (`ZoneInfoNotFoundError` → "NOT FROZEN"), which is not a measurement.
- [x] **Pre-push hook installed** (2026-10-13). `.git/hooks` had held only samples. `pre_push_guard.py` has no `--install` flag (the hook header is wrong about that), so `tools/pre_push_guard.hook` was copied to `.git/hooks/pre-push` (byte-identical, `cmp`). Verified: a non-master ref exits 0 without running the guard; a simulated master push (stdin only, nothing sent) ran the guard → rc 0. The guard imports no `zoneinfo`, so the hook's system `python` is fine. Still run the guard by hand as in §3.1.
- [x] **Git identity** (2026-10-13): `user.email = unchartedterritory5995@gmail.com` in the repo's `.git/config` (all worktrees); `user.name = Blake Bracco`. ⚠ `~/.gitconfig` still has the placeholder `YOUR_GITHUB_EMAIL` for other repos.
- [ ] **One master merge at a time.** No other session's web deploy is in BUILDING/DEPLOYING.

## 2. Rebase and verify (local, free)

1. `git fetch origin`. Record the new `origin/master` and `origin/production`, and confirm production is an ancestor of master.
2. `git switch -c release/agent-gate-c <fresh>` from `3191545b71`, then `git rebase origin/master`. Expect no conflicts. If A1 has already landed, conflicts can only be in the 2 shared files; resolve them with INDICATORS.
3. Confirm Gate C's file list is unchanged: `git diff --name-only origin/master HEAD | wc -l` = 39 (+ nothing new).
4. Frontend, from `app/`:
   1. `npm ci`;
   2. `npx vitest run src/agent` (baseline on this PC: 74 passed / 3 skipped files; 1,233 passed / 4 skipped tests);
   3. `npx vitest run src/components/chart/builder/agentMutations*.test.js` (baseline 60/60);
   4. the full suite, in chunks if memory is tight. Count files against `find src -name "*.test.js*"`. Compare against the known-baseline failures in `NEW-PC-HANDOFF.md` §4, re-measured on the same master SHA. Never bank a timeout without re-running it alone.
5. **Node 20 build:** `npm run build` under **Node 20.18.0**, the version `Dockerfile.web` pins, not this PC's Node 24.
6. Backend: `.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider <tests\test_uct_agent*.py>`, naming the files (baseline 576 passed).
7. If A1 is already on master: copy `a1-integration/*.txt` back to their `app/src/...` paths (named in each header), run them, then remove them. They are scratch, never committed.
8. Secret / temp-file scan of `git diff origin/master HEAD`; `python tools/check_repo_hygiene.py`.
9. `python tools/flow_worker_watch_coverage.py`. Expect OK; Gate C does not reach flow-worker.

## 3. Release (owner-authorized only)

1. `python tools/pre_push_guard.py` from the Railway-linked worktree. Read its exit code directly, never through a pipe or a trailing `echo`.
2. Push to master. Only `git push` (never `--no-verify`, `-n` or `UCT_SKIP_PREPUSH_GUARD`).
3. **Verify registration** by commit statuses (`gh api repos/.../commits/<SHA>/status`), not the deployments API.
4. Wait for the `master deploy gate` → `promote-production`. Read the promote run's **`promoted`** field, not just its status.
5. Deploys:
   - **web**: SUCCESS, a fresh boot;
   - **worker** and **bars-api**: expected, since they watch `api/**`;
   - **flow-worker**: SKIPPED.
   Prove the code is live by ancestry against `origin/production`, not by uptime.
6. Post-deploy: `tools/hub_nav_smoke.py --auth` (smoke account only, its own Playwright profile). If it FAILS, roll back first and diagnose second (H15).
7. Owner runs `GATE-C-ACCEPTANCE.md` (24 steps) in an admin session.

## 4. Rollback (prepared before step 3)

- Rebuild the rollback branch against the SHA **actually released**:
  ```
  git switch -c rollback/agent-gate-c-v3 <RELEASED>
  git revert --no-edit <BASE>..<RELEASED>
  git diff --stat <BASE> HEAD    # must print nothing
  ```
  `rollback/agent-gate-c-v2` (`c06d45f01b`) reverts the pre-rebase SHAs and becomes obsolete the moment the rebase happens.
- To roll back: push the revert through guard → master deploy gate → promote, and check `promoted`. Railway rollbacks do not hold here.
- Gate B's rollback (`rollback/agent-gate-b`, `2a32b9b633`) is separate. Never combine the two.

## 5. Standing safeguards (unchanged by Gate C; re-check after the rebase)

- Admin-only: `require_admin_dark` stays in `api/routers/uct_agent.py`.
- Spend: Agent cap $5/day (`DEFAULT_CAP_USD`, env `UCT_AGENT_BUDGET_USD`); read-only stop at the shared $15 ledger; at most 2 model calls per request; fails closed.
- Limits: 20/min, 300/h, 1 in flight per member, 120/min global; fails open; deterministic commands are never limited.
- Section A vocabulary stays disabled. No new numeric thresholds.
- Gate C and Indicators A1 never ride in one release.

## 6. Local rehearsal state (2026-10-13 late ET; nothing pushed) — resume here after a shutdown

All of it is local git refs and worktrees, so it survives a full shutdown. Nothing is held only in memory. The suite results are copied into §7 when done.

| Ref (local only) | SHA | Worktree | What |
|---|---|---|---|
| `rehearse/agent-gate-c-on-558c644` | `f05a05b445` | `C:\UCT\gc-rehearse` | Gate C `3191545b71` rebased onto `origin/master` `558c6443f1`: no conflicts, `range-diff` 6/6 `=`, 39 files unchanged |
| `rehearse/rollback-agent-gate-c-v3` | `ba8b3ba1dd` | `C:\UCT\gc-rollback` | 6 reverts of the above; tree identical to `558c6443f1` (`git diff --stat` empty) |
| `rehearse/master-baseline-558c644` | `558c6443f1` | `C:\UCT\gc-master` | the master baseline for the suite comparison |

Each worktree carries a `.uct-session-owner` file (session `3e2dd26d…`). These are **rehearsals**: at release time, redo §2 against the then-current master (with A0 on it), and rebuild the rollback branch against the SHA actually released.

Measured on the rehearsal (`f05a05b445`):
- Node **20.18.0** build (portable copy in the session scratchpad, checksum-verified; system Node 24 untouched): `npm install` + `NODE_OPTIONS=--max-old-space-size=4096 npm run build` → exit 0, built in 1m33s, tree unchanged. Windows, not the Linux image; production `VITE_*` build args unset locally. 70 `EBADENGINE` warnings (`@csstools/*` want Node ≥ 20.19.0), identical on master, so they predate Gate C.
- Backend `tests/test_uct_agent*.py`: **576 passed** (venv Python).
- Footprint outside `app/src/agent/**` + `docs/agent/**`: exactly `turn.py` (1 changed line), `agentMutations.js`, `agentMutations.inputs.test.js`, `controlDoorCensus.test.js`. Secret / temp-file scan: no matches. `check_repo_hygiene.py`: clean.
- `require_admin_dark` present; `budget.py`, `limits.py`, `api/routers/uct_agent.py` unchanged vs master; `DEFAULT_CAP_USD = 5.0`, `DEFAULT_MAX_CALLS = 2`.
- `flow_worker_watch_coverage.py`: OK (changed 39, watched 24, no intersection).
- Landing simulation (`merge-tree`, rc read directly): A0 → master clean; Gate C → master+A0 clean; A1 → master+A0+Gate C clean. A0 ∩ A1 = 0 files. A0 is 196 behind / 5 ahead of master.
- Railway (read-only): web's latest deployment is `b80e0bf818` while `origin/production` is `d2a7b4822c`; the three commits between them touch only `docs/**`, so web correctly did not rebuild.
- Deploy freeze (venv Python): NOT FROZEN at 2026-10-13 23:38 ET. The system Python fails open (no `tzdata`).

**To resume after a shutdown:** `git worktree list`; confirm the three refs above; `git fetch origin`; re-read `origin/master` / `origin/production`. If master moved, redo the rebase rehearsal. Re-run any suite that §7 does not record as finished, with the same settings on both trees.

## 7. Full frontend suite — master vs Gate C (2026-10-14 ~04:00–05:15Z; local, nothing pushed)

Identical configuration on both trees: `python scripts/gate_shards.py --shards 6 --max-workers 6`, system Node v24.20.0, deps from `npm ci` / `npm install` under Node 20.18.0 (same lockfile), clean trees verified at start and end by the wrapper, every test file accounted for. A first run at 2 workers was stopped at the owner's request before any shard finished (nothing to preserve: shard output is written only on completion).

| | master `558c6443f1` | Gate C rehearsal `f05a05b445` |
|---|---|---|
| Test files | 3,404: **20 failed** / 3,353 passed / 31 skipped | 3,407: **16 failed** / 3,360 passed / 31 skipped |
| Tests | 46,494: **16 failed** / 46,302 passed / 175 skipped / 1 todo | 46,535: **12 failed** / 46,350 passed / 172 skipped / 1 todo |
| Tree start = end | yes | yes |
| Failing identities | 23 | 19 |

(The wrapper's own "NEW vs baseline" line compares against its stored historical baseline, not master; it is not the Gate C comparison.)

**Failures only on Gate C: 0.** Every one of Gate C's 19 failing identities also fails on master. They are pre-existing; the handoff's known list (`targetScriptReport.measure`, `panelContract.rail`, `exportFormats.roundtrip`, `fidelityCarryovers.roundtrip`, `formControls.terminal`, `jsonFetcher`) plus master's newer reds (`symbolFoldParity`, four engine `*.measure` censuses, journal-2-0 `calloutNode.variant`, `dateMentionNode`, `exportRoundtrip`, `noteBatch.jsonRoundtrip`, `selectionExport.roundtrip`).

**Failures only on master: 4**, each investigated rather than banked:
- `StockChart.smoke`, `pollingSites.rail`, `ScanObjectCard`: all pass when re-run alone on master (`pollingSites` 23 s, `ScanObjectCard` 5 s) → load-sensitive. `StockChart.smoke` alone still throws one unhandled error on master (a chart mock without `subscribeVisibleTimeRangeChange`); Gate C does not touch `StockChart`.
- `iteratorGlobalFloor`: reads BUILT output. Master's tree has no build ("app/dist/assets missing — run `npm run build`"). On Gate C it read the Node 20.18.0 production build and **passed**, so the Gate C build is clear of unshimmed globals below the iOS ≥ 16 floor.

The Gate C additions (+3 test files, +41 tests) all pass.

**After the shutdown (2026-10-14 ~09:10 ET):** `origin/master` = `origin/production` = `248d6c6819` (50 commits past the rehearsal base). Those 50 commits overlap Gate C's 39 files in **0** files and touch **none** of the frozen shared files; `merge-tree` of the rehearsal onto the new master is clean. A0 (`b8da8233f7`) and A1 (`2928cfc55e`) unchanged and not landed. The rehearsal therefore still holds, but release time redoes §2 on the then-current master with A0 on it.

