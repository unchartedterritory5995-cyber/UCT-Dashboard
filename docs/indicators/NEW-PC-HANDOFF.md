# UCT Indicators: new-PC handoff (2026-10-14)

From the old Windows PC (`C:\Users\blake`, worktrees under `C:\w\…`) to the new PC (`C:\UCT\indicators`).

Written by the old Indicators Claude session. **The old session stays running until the new PC has verified the transfer (§9).**

> **Standing rules carry over unchanged:**
> - No merge, no push to `master` or `production`, no deploy, and no paid model calls without the owner's explicit, separate authorization.
> - Never merge PR #322 or #323.
> - Never touch the UCT Agent's worktrees or branches (§7).

---

## 1. State at handoff (verified 2026-10-14 ~03:00Z)

| Ref | SHA | Notes |
|---|---|---|
| `origin/master` | `0e5e1dcd86` | 2 commits ahead of production |
| `origin/production` | `b80e0bf818` | |
| **A0 candidate** `origin/release/indicators-a0` | **`b8da8233f7`** (RC3) | draft PR **#322**. **Not merged.** Merges cleanly onto current master |
| A0 CI fix branch `origin/fix/indicators-a0-security-ci` | `0e1d42d785` (RC2) | draft PR **#323**, which holds the complete Linux security validation. **Keep it; never merge.** |
| **A1 candidate** `origin/feat/indicators-a1` | **`2928cfc55e`** | draft PR **#325**. **Not merged.** Base `66cd9fe126`. Merges cleanly onto current master and onto A0 |
| `handoff/indicators-new-pc` (this branch) | see the PR or branch head | master + docs only: the audit docs, the C4 design and this file |
| local tags `indicators-a0-rc1` / `indicators-a0-rc2` | commits `f37a754a06` / `0e1d42d785` | **only in the bundle** (§5) |

**Open PRs that touch Indicators:**
- #322, #323 and #325: drafts, do not merge.
- #235 `pine/builder-candle-refuse`: older, not part of A0/A1, status not re-checked. Leave it alone.

### In flight at handoff

| What | State | Action for the new PC |
|---|---|---|
| A0 full-suite run **38466871759**, attempt 2 (re-ran `tests-10`, publish, diff) | `tests-10` **passed** (17.5 min, under its 20-min cap). The **publish** job is queued in the shared `ci-results-publish` group | check §8.1. If publish was cancelled again, re-run it (§8.1) |
| A1 full-suite runs 38492420145 / 38494445941 | both ended (the frontend job hit master's 45-min cap; the second was cancelled by me) | none. A1 frontend evidence is the local full run (§3.3) |
| old-PC background watcher | polls run 38466871759 until it completes | none; it dies with the old session |

---

## 2. A0: the formula-execution safety net (release-ready, pending final authorization)

### 2.1 What A0 is

| Commit | Change |
|---|---|
| `a6093dff2c` | A0 safety net for formula execution; no behaviour change for valid documents |
| `0c291d345a` | Phase A0 report |
| `f37a754a06` | flow-worker marker bump **#17** (#16 is reserved for the UIE alert-coverage RC) |
| `0e1d42d785` | security-suite CI: Node 20.19.0, `pipefail`, exact `Test Files 18 passed (18)` |
| `b8da8233f7` | `tools/ci_summarize.py` reads a vitest totals line that carries a `todo` count; it is order-free |

A0's own commits change **no `app/src` file**. They touch only `api/`, `tests/`, `tools/`, workflows and docs.

### 2.2 Evidence

**Linux security validation** (PR #323, run 38440057024, head `0e1d42d785`):

| Half | Result |
|---|---|
| Python | 1,356 passed, 5 skipped, 1 deselected (Python 3.12.15) |
| Frontend | 18/18 files, 397 passed, 1 skipped (Node v20.19.0) |

**Full suite on RC3** (run 38466871759):
- **Frontend log totals:** files 18 failed, 3,341 passed, 31 skipped (3,390); tests 18 failed, 46,122 passed, 128 skipped, 1 todo (46,269).
- **The fixed summarizer reads the log correctly:** collected 46,269, passed 46,122, failed 18, skipped 129. That 129 is **128 skipped + 1 todo**: the summarizer folds `todo` into `skipped` by design (`ci_summarize.py:98`). The total is exact, but todo is not a separate field. Splitting it out would be a new A0 change and needs owner approval.
- **The 18 failing frontend files are all pre-existing on master:**
  - Pine and vendor measure tests;
  - `targetScriptReport.measure`;
  - `panelContract` (it flags `TimeSalesPanel.jsx`);
  - journal tests;
  - `formControls.terminal` (it flags `SocialPolarity.jsx`);
  - `jsonFetcher` (it flags `useFlagged.js`);
  - `iteratorGlobalFloor` (it needs built assets);
  - `heatmapRegistry.golden`.

  A0 cannot cause any of them, since it changes no app code.
- **Python:** compared with master on A0's base `1eba7c105c`, A0 **fixed 6 modules** and adds no failure. `test_massive_ws_stop` is flaky on master too (6/6).

### 2.3 The `tests-10` shutdown hang

This is a documented, pre-existing infrastructure issue, **not an A0 blocker**, under the owner's four conditions:

| Condition | Met by |
|---|---|
| Results reported accurately | **Linux CI:** 30 failed / 3,402 passed. **Clean master locally:** 28 failed / 3,395 passed |
| Behaviour confirmed on clean master | it reproduces there: ~11.5 min alive after pytest's summary |
| No new A0 failures | as above |
| Documented for the `api/main.py` owner | `docs/indicators/audit-2026-10-13/phase-a/A0-CI-FINDINGS-2026-10-13.md` (on this branch). Cause: the industry-map prewarm calls `fh_get`, which logs "FINNHUB_API_KEY not set" per ticker after the session ends |

On attempt 2, `tests-10` finished inside its cap.

### 2.4 Still open for A0

1. **The owner's final release authorization** (merge and deploy). Not given.
2. The published `ci-results` record for 38466871759 (see In flight, §1).
3. Optional, owner-only: report `todo` separately in the summarizer.

**Workflow weakness found.** The publish job's concurrency group `ci-results-publish` keeps only **one pending** job. A newer run's publish silently cancels an older pending one. My A1 draft-PR runs cancelled A0's first publish this way. Any branch's run can cancel another's queued publish. This is a CI follow-up for the workflow owner and is not fixed here.

---

## 3. A1: undo, hide and preservation (draft PR #325, CI validation only)

### 3.1 The commits

All 15 commits are on `feat/indicators-a1` and can be reverted one at a time.

| Commit | What |
|---|---|
| `f5b332f77f`, `859bdf538a` | docs: readiness audit; the Agent's boundary reply |
| `6124a78484` A1.0 | move the change-record helpers into `engine/settingsRecord.js` (no behaviour change; Agent-approved, parity test) |
| `eaf58133f0` A1.1 | turning an indicator off **hides** it; it never deletes (D3) |
| `fa8336a5c8` A1.2 | exact, never-stale Undo ("RSI hidden · Undo"), with keys in the shortcut registry |
| `abbd873a54` | A1.0–A1.2 stage report |
| `5e11acec70` A1.2b | Undo/Redo buttons in Chart Settings → Indicators and the phone ƒx sheet |
| `498579821b` A1.2c | the Undo store's sessionStorage keys are in `persistenceManifest.json` |
| `1d1c97aa73` A1.3 | Restore Defaults and presets keep indicators and MA colours (Q5). Templates are undoable. Share links apply once and ask "Use theirs" / "Keep mine" (Q6) |
| `3cb77291e1`, `415999e9a9`, `6719a8883f` A1.3b | layout-apply Undo under the Agent's `layout.open` rules (Q7). It refuses when unsaved work was discarded; the toast shows only once the switch has landed; ids compare as strings |
| `11d15ac982` A1.4 | indicators that can't be shown are named, with Remove / Keep / Repair / Open in Builder. No silent RSI substitution; the v1 fold keeps records raw; a deletion syncs across tabs |
| `1311765c84` | the layout toast dismisses when the board moves on to another layout (found by the Agent integration test) |
| `2928cfc55e` | ChartPane comment correction (the Agent writes through ChartWidget `api.agent.commit` → onOptsChange) |

### 3.2 Owner decisions already applied

- **Q1:** MA hide/show all, the same as Ctrl+M.
- **Q2:** Restore formula is a later follow-up.
- **Q3:** A1.3b is a separate commit.
- **Q4:** no "Also remove indicators" option.
- **Q5:** keep MA colours; Repair notice instead of substitution.
- **Q6:** "Use theirs" / "Keep mine"; "Add theirs" is deferred.
- **Q7:** reopen the previous layout, and refuse when unsaved state can't be restored. "Never falsely claim unsaved work was recovered."

### 3.3 Test evidence on the exact SHAs

| Run | Result |
|---|---|
| **Full frontend suite, local, `2928cfc55e`** | files 7 failed, 3,364 passed, 31 skipped (3,402); tests 5 failed, 46,242 passed, 151 skipped, **1 todo** (46,399); 933 s |
| Targeted on `2928cfc55e`: `src/pages/charts`, `chart/pane`, `src/agent` | 209 files, 2,693 tests passed |
| On `11d15ac982`: A1 tests + `chart/builder` + `src/agent` + `chart/pane` | 254 files, 4,547 passed |
| Same SHA: `lib/persistence`, `pages/command`, `pages/charts`, `chart/engine`, `hooks` | 968 files passed; 1 failure, `targetScriptReport` (also fails on master) |
| CI, PR #325 | the quick checks (allowlist, build-args, bytes, latency, rails, static) pass, and all 20 pytest shards pass |

**The 7 failed files in the local full run** are all outside A1. A1 changes none of them and none of the files they flag:
- `targetScriptReport.measure`;
- `panelContract.rail` (`TimeSalesPanel.jsx`);
- `jsonFetcher` (`useFlagged.js`);
- `formControls.terminal` (`SocialPolarity.jsx`);
- two journal round-trip files and `iteratorGlobalFloor`, which failed without running a test. `iteratorGlobalFloor` checks built assets that a local run doesn't produce.

**The CI frontend suite cannot finish for A1 yet.** Master's `full-suite-report.yml` has `timeout-minutes: 45`; A0 raises it to 100. Until A0 lands, a full-suite record for any branch off master reads the frontend as "not finished". That is a tooling limit, not an A1 failure. **Never report that record as passing.**

**Lint:** no new categories. A1 adds one more export to `IndicatorLibraryDialog.jsx`, matching the 4 existing ones, plus test-file `no-undef` globals and one unused destructure in a new test. CI does not run eslint.

### 3.4 Agent integration (approved by the owner for release-readiness)

The Agent session tested `11d15ac982` and then `2928cfc55e`: **all 5 items pass.**

1. **Agent writes are never recorded on the Indicators Undo stack:** add, hide, show, remove, and setInputs on A1 + Gate C.
2. **Member Undo/Redo, interleaved with Agent edits on the same chart:** 6/6, with honest "changed since" refusals.
3. **`layout.open` receipts vs the A1.3b toast:** 5/5. The stale-toast issue it found is fixed in `1311765c84`.
4. **Suites:**
   - **A1:** 230/231 files; the one failure is an `EvidenceTab.doors` timeout under load that passes 10/10 alone;
   - **A1 + Gate C:** 1,332/1,333 files; the failure is `targetScriptReport` (pre-existing);
   - **on `596f7ebd45`:** 365 files, 5,278 passed, 0 failed.
5. **Gate C rebases onto A1 with no conflicts.**

### 3.5 Still open for A1

1. **Owner authorization to merge, promote or deploy.** Not given.
2. **Rebase onto master before landing:** a clean `merge-tree` was checked at `0e5e1dcd86`.
3. **Landing order:** A0 should land first, so A1's CI frontend run gets the 100-minute cap. A0 + A1 merge-tree is clean. With Gate C, whoever lands second rebases.

---

## 4. C4: grid indicator isolation (design only, nothing implemented)

- **The documents:** `docs/indicators/a1/C4-CHART-LOCAL-INDICATORS-PROPOSAL.md` (options) and **`docs/indicators/c4/C4-FINAL-DESIGN.md`** (final design), both on this branch. The original local branch `design/indicators-c4` is `ae50dbf8b1`, in the bundle.
- **The owner approved Q1–Q6:**
  - Reset Grid Indicators;
  - the shared modal moves onto the board record;
  - volume included, current semantics kept;
  - templates carry it;
  - popup leakage is a separate project;
  - phone and desktop share it.
- **The design:** an optional board-level `multichart_state.indicatorDelta`, split in `StockChart`'s write funnel. Indicator edits never go to global; there is no migration; C4.0 lands first so a rollback keeps the data.
- **Three owner confirmations are still needed before coding** (§11 of the design):
  1. Pre-C4 templates keep the current delta.
  2. Reset appears in both the menu and the modal.
  3. The modal's appearance mismatch is a separate follow-up.
- **C4 is not authorized for implementation.** When it is, use its own branch, `feat/indicators-c4`.

---

## 5. Local-only work and how it is preserved

### 5.1 Included on this pushed branch (docs only)

- the competitive audit, Phase A decision, A1/A2 plans, A0 release records and A0 CI findings (from local `audit/indicators-competitive-2026-10-13`, `f4e9a4d14d`);
- the C4 proposal and final design (from local `design/indicators-c4`);
- this file.

### 5.2 Git bundle

Folder on the old PC: `C:\Users\blake\uct-indicators-handoff\`.

| File | Size | SHA-256 |
|---|---|---|
| **`uct-indicators-local-2026-10-14.thin.bundle`** (use this) | 1,344,278 B | `de2b86b7c0040eee05e810bd90848be73d8c5a3c4e8556001be654c5d5803289` |
| `uct-indicators-local-2026-10-14.bundle` (full-history fallback) | 689,263,276 B | `1f7a0549b97571c07cbe8e924fba42c1a375d3b417e743fa3581da206c0fe09e` |

- The thin bundle needs 8 prerequisite commits. All 8 are ancestors of `origin/master` (verified), so any up-to-date clone has them.
- **Refs in both bundles:**

| Ref | SHA | What it is |
|---|---|---|
| `refs/heads/audit/indicators-competitive-2026-10-13` | `f4e9a4d14d` | audit docs (also on this branch) |
| `refs/heads/design/indicators-c4` | `ae50dbf8b1` | C4 docs (also on this branch) |
| `refs/heads/prep/indicators-a1` | `6b122442ce` | A1 **before** the rebase onto master, plus the C4 proposal. Superseded by `feat/indicators-a1`; kept for history |
| `refs/heads/fix/indicators-a0-safety` | `6f4847b12e` | early A0 development branch (superseded by `release/indicators-a0`) |
| `refs/heads/feat/indicators-a1` | `2928cfc55e` | the same as `origin/feat/indicators-a1` |
| `refs/heads/feat/indicators-phase2` | `02e9aca667` | 09-12, 41 patches not on master: historical, not reviewed in this session |
| `refs/heads/feat/indicators-hybrid2` | `4c13d42063` | 09-16, 1 patch: historical |
| `refs/heads/feat/mtf-indicators` | `7cb819b9fd` | 09-28, 1 patch: historical |
| `refs/tags/indicators-a0-rc1` | → `f37a754a06` | A0 RC1 |
| `refs/tags/indicators-a0-rc2` | → `0e1d42d785` | A0 RC2 |

### 5.3 Other archives in the same folder

- **`uncommitted-files-2026-10-14.tar.gz`** (304,912 B): untracked scratch, all optional:
  - `indaud/app/src/__audit_scratch__/` (audit probe tests);
  - three local Vite preview configs (`indbase`, `ind`, `mtf`).
- **`claude-memory-2026-10-14.tar.gz`** (628,725 B): this PC's Claude Code memory directory (`MEMORY.md` + topic files), which holds the Indicators history and gotchas. It has been checked for credentials and contains none.

### 5.4 Deliberately NOT included

These are owned by other sessions; leave them alone:
- **UCT Agent:**
  - `draft/indicators-setinputs` (Gate C's setInputs draft);
  - `tmp/gatec-on-a1`, `tmp/gatec-on-a1-b`;
  - `feat/agent-*`;
  - worktrees `C:\w\a1gc`, `C:\w\a1int`, `C:\w\aconvc`, among others.
- **Market Intelligence:** `feat/indicator-slice2`, `backup/market-indicators-prerebase`.
- **UIE:** `feat/uie-alert-coverage` (`C:\w\uie7`, never touch).
- **thinkScript:** `C:\w\rpw` (never touch).

The old PC has 58 local-only branches in total. The rest belong to Agent, Breadth, MI, UIE, Notebook and others.

---

## 6. Recovery on the new PC (PowerShell)

### 6.1 Copy the handoff folder

Copy `C:\Users\blake\uct-indicators-handoff\` from the old PC to the new PC, at `C:\UCT\handoff\`, by USB drive or a network share. Then verify the hashes:

```powershell
Get-FileHash C:\UCT\handoff\uct-indicators-local-2026-10-14.thin.bundle -Algorithm SHA256
# expect DE2B86B7C0040EEE05E810BD90848BE73D8C5A3C4E8556001BE654C5D5803289
```

### 6.2 Fetch everything

```powershell
cd C:\UCT\indicators
git fetch origin --prune
git rev-parse --short=10 origin/release/indicators-a0     # b8da8233f7
git rev-parse --short=10 origin/feat/indicators-a1        # 2928cfc55e
git rev-parse --short=10 origin/handoff/indicators-new-pc # matches the HANDOFF READY report
git bundle verify C:\UCT\handoff\uct-indicators-local-2026-10-14.thin.bundle   # must say "is okay"
# Bring the bundle's branches in under their OWN namespace, so no local branch is clobbered:
git fetch C:\UCT\handoff\uct-indicators-local-2026-10-14.thin.bundle "refs/heads/*:refs/remotes/oldpc/*" "refs/tags/indicators-a0-rc1:refs/tags/indicators-a0-rc1" "refs/tags/indicators-a0-rc2:refs/tags/indicators-a0-rc2"
git branch -r --list "oldpc/*"
git rev-parse --short=10 "indicators-a0-rc1^{commit}"   # f37a754a06
git rev-parse --short=10 "indicators-a0-rc2^{commit}"   # 0e1d42d785
```

### 6.3 Separate worktrees

Use one worktree per line of work, so the main clone and the Agent's worktrees are never shared:

```powershell
cd C:\UCT\indicators
git worktree add C:\UCT\ind-a0 -b release/indicators-a0 origin/release/indicators-a0
git worktree add C:\UCT\ind-a1 -b feat/indicators-a1   origin/feat/indicators-a1
git worktree add C:\UCT\ind-c4 -b design/indicators-c4 oldpc/design/indicators-c4
git -C C:\UCT\ind-a0 branch --set-upstream-to=origin/release/indicators-a0
git -C C:\UCT\ind-a1 branch --set-upstream-to=origin/feat/indicators-a1
```

### 6.4 Toolchain and a smoke test

- Node 20.19.0 is needed (the A0 security suite pins it).
- Python 3.12 goes in a venv.

```powershell
node --version
cd C:\UCT\ind-a1\app; npm ci
npx vitest run src/components/chart/indicatorHistoryStore.test.js src/pages/charts/layoutUndo.test.js src/pages/charts/ChartsWorkspace.previousLayout.test.jsx
cd C:\UCT\ind-a0; py -3.12 -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe tools\ci_summarize.py --self-check    # expect 19/19
```

The test paths, `requirements.txt` and `--self-check` were checked against the repo on the old PC. The commands themselves have not been run on the new PC yet.

### 6.5 Claude memory (optional but recommended)

Restore it into the new project's memory folder. The folder name is derived from `C:\UCT\indicators` and is normally `C--UCT-indicators`.

```powershell
$m = "$env:USERPROFILE\.claude\projects\C--UCT-indicators"
New-Item -ItemType Directory -Force $m | Out-Null
tar -xzf C:\UCT\handoff\claude-memory-2026-10-14.tar.gz -C $m     # creates $m\memory\
```

The memory notes are background, not instructions. Re-verify any SHA they name.

---

## 7. Working alongside the UCT Agent (Gate C)

- **Ownership:** the Agent owns conversational interpretation and action orchestration. Indicators owns indicator behaviour and persistence. **Do not implement Agent logic, and do not edit Agent routing, prompts or conversation context.**
- **Gate C status:**
  - the Agent session is preparing Gate C's release candidate against production, **without** A1;
  - Gate C's current head was `e8e4985352`, and its setInputs commit was `bd91b4175c`;
  - rebased on A1 it is `tmp/gatec-on-a1` → `596f7ebd45` (Agent-owned; do not use it);
  - it is unreleased.
- **Gate C's footprint in the Indicators area** is exactly 3 files: `app/src/components/chart/builder/agentMutations.js`, `agentMutations.inputs.test.js`, and a `controlDoorCensus.test.js` row.
- **Landing order is clean either way; whoever lands second rebases.** If Gate C lands first, A1 rebases over those 3 files. The Agent has shown it applies cleanly onto A1.
- **Don't interfere:**
  - never check out, rebase, stash in, or delete an Agent worktree or branch;
  - never push to an Agent branch;
  - never reuse a worktree path the Agent uses;
  - keep Indicators worktrees under `C:\UCT\ind-*`.
- **Talk to the Agent** by cross-session message (`ListAgents` → `SendMessage` to `AGENT`) for:
  - any shared-file change (`agentMutations.js`, `ChartPane.jsx`, `ChartWidget.jsx`, `ChartsWorkspace.jsx`, `settingsRecord.js`);
  - any change to Undo or layout behaviour;
  - an integration test on an exact candidate SHA.
- **Cross-session review:** the Agent must review before it edits Indicators files, and Indicators asks for review before touching Agent-adjacent files.

---

## 8. First tasks for the new Indicators Claude

1. **Confirm A0's record published:**

   ```powershell
   gh run view 38466871759 --json status,conclusion,attempt,jobs --jq '{status,conclusion,attempt,jobs:[.jobs[]|select(.conclusion!=\"success\")|.name]}'
   git fetch origin ci-results; git show origin/ci-results:results/38466871759/summary.json
   ```

   If publish was cancelled again, run `gh run rerun 38466871759 --failed` at a time when no other run's publish is queued. Then check `summary.json` and `diff.json`:
   - the vitest totals line was found;
   - collected is about 46.3k;
   - no new failures against the baseline.
2. **Report A0 readiness to the owner.** Merge and deploy only with the owner's explicit final authorization.
3. **A1:** wait for authorization. When it comes, rebase onto master, re-run the A1 suites (§3.3) and request an Agent integration re-check on the new SHA.
4. **C4:** get the 3 owner confirmations first (§4). Implement only when authorized.

## 9. Proving the transfer before the old session is shut down

On the new PC, all of these must hold:
- the §6.1 hash matches;
- `git bundle verify` says "is okay";
- the §6.2 SHAs match;
- `git branch -r --list "oldpc/*"` shows 8 branches;
- this file opens from `origin/handoff/indicators-new-pc`.

This recovery was rehearsed on the old PC in an empty repo holding only `origin/master`: the bundle verified, the 8 `oldpc/*` branches and both tags came back, and `git fsck --connectivity-only` was clean.

Then tell the owner: **"new PC verified"**. Only after that may the old session be closed.

## 10. Constraints, verbatim, carried forward

- "Do not push, merge, or deploy A1 without separate authorization."
- "No paid model calls, no production deployment, no merges, and no unrelated infrastructure changes."
- "Do not modify Agent routing, prompts, or conversation context."
- Never print production secrets or keys. No production reads (fetching the production JS bundle was denied; do not retry, and never route a denied read through a peer session).
- Never print real market values: counts, dates and pass/fail only.
- Keep the advanced Pine runtime disabled. The UCT Agent stays admin-only.
- Never use a bare `git stash`. Delete localStorage keys only by exact name. No force pushes.
- Commits end with:
  - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - the session link the new session is given.
