# UCT Agent Lead: migration handoff (2026-11-06)

Written by the UCT Agent Program Lead session (`blake-b1`) on the old PC before the move to a second computer. It records state; it grants no approvals. AUDIT's conclusions are AUDIT's own and live in AUDIT's checkpoint (see section 4). Nothing here is a secret: no tokens, passwords or keys.

## 0. Status at handoff

- **Nothing new is running from this session.** No merge, deploy, runner registration, credential change or CI change was made for the handoff.
- **master = production = `61f49a2843`** (#897, not ours).
- **Repository:** https://github.com/unchartedterritory5995-cyber/UCT-Dashboard (private).
- **All local work is on GitHub.** Every local branch with commits not on any remote was pushed to `handoff/2026-11-06/<original branch name>` (71 branches plus 4 detached worktree heads under `handoff/2026-11-06/detached/`). Uncommitted diffs and untracked files from other worktrees are archived in `docs/handoff/2026-11-06/uncommitted/` (section 9).
- **One mistake during the handoff:** pushing the `handoff/2026-11-06/*` refs started CI on the older branches, whose own workflow files run on any push. All 75 runs still pending were cancelled within about 2 minutes; about 50 billed minutes (about $0.30) were spent. The push also used `--no-verify` unnecessarily. No hook is installed in this clone, so nothing was skipped, but don't copy that. **Do not push to `handoff/*` again.** Restore from those refs locally; never push to them.

## 1. Roadmap and priorities (owner-set)

UCT Agent is, in order: a fast natural-language operator and visual guide for the site; a market research assistant; an opt-in trading coach. The authoritative contract is `docs/UCT_AGENT_PRODUCT_CONTRACT.md`.

- **Phase 1 (current):** Charts mastery. The Agent can do AND visually teach every meaningful human action in the Charts workspace.
- **Phase 2:** all authorized UCT information from inside Charts.
- **Phase 3:** other workspaces. No non-Charts page hosts now; `agent/pl/morning-wire-host` (`d98e4845ad`) stays stopped and must never merge.

Standing principles:
- Build capability families, not phrases; test held-out phrasings.
- Never guess a target, and never let a clicked chart stand in for a described one.
- Never claim success without read-back.
- Track execution and teaching coverage separately.
- Label evidence SIMULATED, BROWSER-MOCK-MODEL or REAL-MODEL.
- No paid model calls without explicit owner authorization.
- Owner testing is optional: Claude finds and fixes failures through real UI testing.

**Owner priority right now:** finish a CI system under **$200/month total** with no weakened tests, gates or safeguards, then resume full-speed Charts work. The second computer will be evaluated as a CI host after migration (section 6).

## 2. Open PRs and active branches

AUDIT is the sole merger and deployer. Its queue order: **#896 → #851 → promotion fix → #864 → #858**, then #873, #845, #866, #872 as each clears. Re-push nothing until the queue reaches it, to avoid paid CI that would be overtaken.

| Item | Branch | Head | State | Next action |
|---|---|---|---|---|
| #896 secret-scan range fix | `fix/gate-secret-scan-since-production` | `2fc3984b0f` | AUDIT's PR; delta review after 3 findings fixed | AUDIT says its merge was denied by its session's permission check: owner merges or allows AUDIT to. Base is behind master, so checks are rechecked first |
| #851 spend limits ($1 vision, 20 in flight, 480 s) | `agent/pl/spend-new-limits` | `70158b9fdb` | Refreshed on master; shard-3 flake rerun green (run 42300414503) | Merges alone after #896. Limits hold only with one web replica |
| Promotion safety fix | `agent/pl/promotion-superseded` | `1b78dea234` | Pushed, branch only, no PR; AUDIT approved the content | Owner's go to AUDIT, then AUDIT opens and merges it alone |
| #864 guide named targets | `agent/pl/guide-named-target` | `4f7ce58eea` | AUDIT passed it at `c26cc05ad9`; another session merged master in at 03:36Z | AUDIT rechecks the new head |
| #858 autotest fixes, early receipt | `agent/pl/autotest-fixes-1` | `fa0b5de082` | AUDIT verified at `3d12b1fdd4`; master merged in at 03:36Z | AUDIT rechecks the new head |
| #866 real-model defect fixes | `agent/pl/real-model-fixes-1` | `2794867fb6` | R1 fixed at `fb3ecf7c81`, then master merged in | AUDIT delta check of R1 |
| #872 F-16 Calls Only | `agent/pl/f16-widget-claim` | remote `3afb983c77`; **local fixes `9fb3bdce28` are only on `handoff/2026-11-06/agent/pl/f16-widget-claim`** | Held: D1–D4 envelope fixes done locally, never pushed (diverged from remote) | Merge remote into the local fixes (no force push), push, AUDIT review. PR body draft: section 9 |
| #873 F-16 pin commit rule | `agent/pl/f16-pin-commit-rule` | `7f9fcc4d4f` | Meets AUDIT's conditions; two rollups were blocked by billing | Rerun rollups, then the queue |
| #845 alert on new drawing | `agent/pl/plan-new-id-truth` | `aa0447406a` | Needs one refresh after #851, plus one PR-body line naming the `drawing.setAlert` hint change | After #851 |
| #837 history.eventStudy cold store | `agent/pl/history-study-read` | `8709300c63` | Not cleared | Later |
| clarify-target-2 | `agent/pl/clarify-target-2` | `6ab44a1786` | No PR | Open the PR only once #858 is LIVE; full wrong-target review |
| Guide follow-ups | `agent/pl/guide-followup-1` | `1059f6483b` (contains `ae6d471afe`) | Pushed, no PR; all local checks green | Owner ruling on 2- vs 1-letter bare tickers; PR after #864 is on master |

Local-only work, now preserved under `handoff/2026-11-06/…`; none of it is reviewed by AUDIT:

| Branch | Head | What it is |
|---|---|---|
| `agent/pl/target-plus-multichart` | `2c9457ea9b` | **Main next Agent PR.** Multi Chart control plus wrong-target fixes, combined. Public selection 210/213. Two full Linux runs fail one test, `agentOpenChart.test.jsx` "NO chart: … full board … refused", at about 9.1 s, only under full-run load. It passes alone and in shard 3 alone. Not yet proven whether the read-back change in `runtime.js` causes it. Next: compare shards 3+4 together at `2c9457ea9b` vs `bcbc8a23e8`, then a load run with `runtime.js` reverted. Needs an all-green run before AUDIT review |
| `agent/pl/target-truth-1` | `62a3bf2393` | Wrong-target fixes alone (drawings bypassing guards; `screenUnnamedTargets` always counting the click; `host.js` midline). Held-out 64/66 |
| `agent/pl/multichart-control` | `a182051105` | Multi Chart, 8 actions. Full Linux run passed |
| `agent/pl/selection-oracles` | `cf0203be6b` | Selection-state oracle, plus coverage recount tool `recount.mjs` |
| `agent/pl/ci-runner-kit` | `38e2f55d65` | Self-hosted runner kit, routing drafts, `ci_equivalence.py`, `ci_queue_watch.py`, docs in `infra/ci-runner/` |
| `agent/pl/ci-cost-tools` | `0bff381329` | Cost report, model and measurement tools, `docs/ci/*` |
| `agent/pl/autotest-harness` | `e7926a4984` | Autotest harness |

Owner decision still open: does a bare follow-up ("now log scale") stay on the chart named in the previous request? Test `flow-followup-keeps-the-named-chart` is left red until decided.

## 3. Coverage (local harness, scripted model)

Recount on master `768816c654`:

| Measure | Count |
|---|---|
| Execution | 170 of 484 |
| Browser Agent-executed rows | 77, or 71 under the strict oracle |
| P0 rows in the browser | 60 of 74 (strict: 53) |
| P0 rows at panel level | 67 of 74 |
| Teaching | 283 of 499 (not re-run) |

The last real-model production run (Nov 5): 47 turns, about $0.56, 72% correct.

## 4. AUDIT

- **AUDIT checkpoint (local only, by AUDIT's choice):** `C:\Users\blake\uct-audit-checkpoint-2026-11-06`, a local git repository at commit `6496a3d`. Start with `HANDOFF-AUDIT.md`. AUDIT asked that it NOT be pushed to this repository, because several reviews describe unfixed security gaps. **Copy that folder to the new computer by hand.**
- AUDIT says nothing of its is mid-flight. Its PC-runner finding on the old machine is recorded as historical only, neither approval nor rejection, and it will evaluate the new machine from scratch.
- Requirements AUDIT has stated that still bind any CI change (details in its checkpoint):
  - Every workflow branch goes to AUDIT before merge, and silence is not approval.
  - Merging needs AUDIT's approval and the owner's go.
  - A self-hosted result counts only as the Actions job's own conclusion, from a runner workers cannot reach.
  - Promote, the verdict, the secret scan, deploy-correctness and the production check stay GitHub-hosted.
  - No automatic fallback.
- **Owner decisions AUDIT has flagged:**
  - Two outstanding: #853's live `widget.setOption` can set any Options Flow chip (approval was Calls Only); the server F-16 check depends on a client-sent manifest.
  - Merges on the shared account can't be attributed: another session merged master into seven Agent PRs at about 03:36Z on Nov 6.

## 5. CI cost findings

Billed at $0.006 per job-minute; the plan is inferred to be GitHub Free with $12 included.

- **Actual:**
  - About $336 gross on Nov 1–6 (estimate from job timestamps).
  - Budget stops hit Nov 4 and Nov 6.
  - Since #877, a measured 18-hour window spent $21.65, about $29 a day, below normal volume.
- **Modelled, USD/month total** (`docs/ci/ci-cost-model.md`, `docs/ci/ci-hosted-only.md` on `ci-cost-tools`):

| Architecture | Normal | Every day like Nov 5 |
|---|---|---|
| GitHub as today, after #877 | about $653 | about $954 |
| GitHub-only, every AUDIT-allowed lever (30/60-min gate coalescing, strict tree reuse, 2 shards, Pro, weekly nightly) | about $467 | about $649 |
| Hosted floor (rails plus merge-candidate runs, no gate) | about $201 | about $371 |
| One independent x64 runner machine for heavy gate jobs, plus hosted core | about $145 | about $175–191 |

- **The only modelled design under $200 needs an independent runner machine** for the heavy gate jobs: browser shards, the equivalence rail, Agent server tests, and 5–8 movable rails.
- **Measured setup is small** (56 of 730 s per shard), so caching doesn't help.
- **AUDIT rulings on the hosted levers:**
  - Gate coalescing: at most 30 min in market hours, 60 off-hours; 120 is refused.
  - Tree reuse only under strict proof.
  - Managed third-party runners are ruled out while workers' tokens hold admin.

## 6. Local test architecture (reusable)

- **Old PC:** WSL distro `uct-ci` running Docker Engine, with ephemeral containers per job, CPU, memory and PID limits, an egress firewall, and automount and interop off.
  - The image is `ubuntu:26.04` by digest; the built image is `sha256:d413a1956e…`.
  - It matched hosted test-for-test: browser 8722 tests and 269 files; server 3654; capability regression 13 and 3535.
- **Rebuilding on the new computer:**
  - Recreate from `infra/ci-runner/` on `agent/pl/ci-runner-kit`: Dockerfile, launcher, `local_validate.sh`, ISOLATION and VALIDATION-PLAN.
  - Pins are in `infra/ci-runner/` and the program-lead memory file.
  - Results under `/srv/uct/results` stay on the old PC and are not needed.
- **Trust facts that made the old PC advisory only:**
  - Every Claude session runs as an account in local Administrators, where UAC is not a boundary, and holds a classic `gh` token with `repo` (admin) scope.
  - So a session could reach a local VM's files or register a fake runner.
  - Hyper-V was not installed. Administrator Protection was not enabled.
- **First checks on the new computer, before any design:**
  - Is the account Claude runs as a standard user or an Administrator?
  - Is Administrator Protection available?
  - What `gh` token type and scopes does it have?
  - Is Hyper-V available?
- Full suites take a slot through `tools/agent_suite_lock.py`.

## 7. Software needed on the second computer

| Tool | Version |
|---|---|
| Git for Windows | Includes Git Bash |
| GitHub CLI `gh` | — |
| Node.js | 20.x (CI uses 20.20.2) |
| Python | 3.12 (CI uses 3.12.16); repo venv at `.venv` |
| Claude Code | — |

WSL2 and Docker Engine are needed only for the local Linux test environment; install them only if the CI evaluation calls for it. Railway CLI is only for owner-run production reads. Chrome is used for isolated headless browser checks.

## 8. Setting up the second computer (PowerShell)

```powershell
# 1. Clone (gh must be logged in as the owner)
mkdir C:\Users\$env:USERNAME\projects
cd C:\Users\$env:USERNAME\projects
gh repo clone unchartedterritory5995-cyber/UCT-Dashboard
cd UCT-Dashboard
git fetch origin

# 2. Read this handoff from its branch
git show origin/handoff/agent-lead-2026-11-06:docs/agent-lead-migration-handoff.md | more

# 3. Restore a worktree for a branch you want to resume (example)
git worktree add C:\w\pl-hist -b agent/pl/target-plus-multichart origin/handoff/2026-11-06/agent/pl/target-plus-multichart

# 4. Dependencies (per worktree that runs tests)
cd C:\w\pl-hist\app; npm ci; cd ..
python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt pytest httpx
```

Restore a branch from the handoff namespace into its original name locally (step 3). **Never push back to `handoff/*`.** When a restored branch is ready, push it to its original name with a normal fast-forward push, or merge the remote in first if it moved. Never force-push.

## 9. Archived uncommitted work (other worktrees)

These were in worktrees not owned by this session. They are saved, not committed to their branches.
- **Location:** `docs/handoff/2026-11-06/uncommitted/`.
- **Contents:** `INDEX.txt` (worktree, branch, head); one `*.patch` per worktree (`git diff HEAD`); `*.untracked.txt` lists; `*-untracked.tgz` archives.
- **Largest:** the main clone (`feat/app-themes`, 1240-line diff plus 26 untracked source files, including `TracingsPanel*`, `ChartDetailDock*`, `floor2/`); `C:/w/intra` (`fix/intraday-current-camera`); `uct-drawing-boards-wt` (`deploy/daily-freshness`).
- **Secret scan:** clean for common token patterns. A directory named `fake_token/` in `C:/w/mtf` was deliberately not archived.
- **To restore one:** `git worktree add <dir> <branch>`, then `git apply <patch>` and `tar -xzf <archive>` inside it.

Also local only on the old PC, to copy by hand if wanted:
- Claude memory: `C:\Users\blake\.claude\projects\C--Users-blake\memory\`. **Recommended:** it holds the program-lead running record and the CI findings.
- AUDIT's checkpoint (section 4).
- Scratchpad folders under `C:\Users\blake\AppData\Local\Temp\claude\…`, including the #872 PR body draft `wf-f16-pr-body.md` and test evidence. Not required.

## 10. Resuming Agent Lead and AUDIT

1. Start AUDIT first, in its own terminal: `claude`, then tell it to read its `HANDOFF-AUDIT.md` from the copied checkpoint folder.
2. Start Agent Lead in a second terminal: `claude`, and tell it: "You are the UCT Agent Program Lead resuming from docs/agent-lead-migration-handoff.md on branch handoff/agent-lead-2026-11-06. Read it and the memory folder. Do not start workers or push until you have verified the checklist in section 11."
3. One Agent Lead and one AUDIT only.
   - Before starting workers, check `git worktree list` and running sessions, and never give two workers the same worktree or files.
   - Unmerged PRs touching `useAgent.js`, `runtime.js`, `deixis.js`, `host.js` or `turn.py` conflict easily.

## 11. Checklist before any CI change or worker push

- [ ] The `gh` login on the new computer is checked: account type and token scopes (`gh auth status`). Nothing is changed without the owner.
- [ ] AUDIT has its checkpoint and confirms its queue.
- [ ] No duplicate sessions or workers. Each worktree has one owner.
- [ ] `master` and `production` are known (`git ls-remote origin master production`).
- [ ] No pushes to `handoff/*`, and no pushes to `agent/**` without need: every push to an `agent/**` branch that touches Agent paths runs `agent ci` (about 36 billed minutes).
- [ ] Budget alerts are on (cost tool in `ci-cost-tools`: `--ceiling 220`, target $200).
- [ ] The new-machine CI evaluation waits for the owner's go, and AUDIT re-evaluates it from scratch.

## 12. Things not done, and risks

- **#872's local fixes** exist only on a handoff ref until merged with the remote branch.
- **`target-plus-multichart`** isn't all-green under full load, with the cause unproven.
- **The guide follow-up** awaits the owner's 1- vs 2-letter ticker ruling.
- **#896** needs an owner-side merge permission decision.
- **The CI architecture** is undecided and depends on the new machine.
- **Shared GitHub account:** merges can't be attributed to a session.
