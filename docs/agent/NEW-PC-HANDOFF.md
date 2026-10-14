# UCT Agent — new-PC handoff (2026-10-13, evening ET)

This is the handoff for the **UCT Agent Conversational Intelligence** work, written for the next Claude Code session on the new Windows PC. Read it end to end before doing anything.

**Nothing in this handoff changes release status.**
- Gate B is live in production.
- Gate C is a prepared, **unreleased** candidate. It has not been pushed to master or production, merged, or deployed.
- No paid model call was made.

| | |
|---|---|
| Repository | `https://github.com/unchartedterritory5995-cyber/UCT-Dashboard` (`origin`) |
| **Handoff branch (remote)** | **`handoff/agent-gate-c-2026-10-13`** = the Gate C candidate + 1 docs commit (this file, plus the A1 integration test attachments) |
| **Gate C release candidate** | **`3191545b714b70fd370ec4f16d5dcd2fa3ea46e3`**: the parent of the handoff branch's docs commit (`handoff~1`), 6 commits |
| Candidate base | `b445c8544025e0c58bf0f2d33d2b16e918f26d95` (production as of the readiness check) |
| Production = master **at handoff** | `b80e0bf8185c22745a8478016da1571d390e6b92` (a Notebook P2b release, #324, landed after the readiness check) |
| Gate B in production since | `c84c9ca7c2190b4b2effa4a5a9a3c0f9e6d55dc0` (2026-10-13, about 16:51 ET) |

> ⚠ The handoff branch's docs commit is **not** part of the release. When Gate C is released, release `3191545b71` (rebased onto the then-current production), not the handoff branch head.

---

## 1. What the project is

UCT Agent is an **admin-only** natural-language assistant inside the UCT dashboard (`/charts` workspace). It changes the member's own workspace: charts, indicators, layouts, watchlists, the screener, breadth and settings. Every change goes through deterministic, reversible, receipted operations.

The Conversational Intelligence project (Option B, built as an evolution of the existing architecture) makes it hold a conversation:
- remember what it just showed or changed;
- resolve references ("the third one", "make it a 9", "do the same on the right one");
- never take a wrong action;
- keep model spend inside hard budgets.

### Architecture (one turn)
1. **`app/src/agent/useAgent.js`**: the panel's controller. In order:
   1. session **memory** + **references** (`memory.js`, `references.js`; Gate C);
   2. **fastParse** (`fastPath.js`; deterministic commands, all-or-nothing clauses, typo correction via `nl/lexicon.js`);
   3. if nothing deterministic applies, **routing** (`routing.js`: picks the capability groups and the context to send);
   4. `POST /api/agent/turn`.
2. **Backend `api/services/uct_agent/turn.py`** (`run_turn`): Claude **Haiku 4.5**, model `claude-haiku-4-5`. It returns ops or a reply.
   - **Gate B** wraps every paid call in `budget.py` (reservation → settle ledger, fails closed) and `limits.py` (rate limits + in-flight leases, fail open).
   - Router: `api/routers/uct_agent.py`.
3. **Frontend execution:** sanitize → `executor.js planOps` → `policy.js decideMode` (instant or proposal) → `runtime.js commitPlan` (one write per target, read-back acknowledgement) → receipt + exact **Undo** (fingerprint-guarded; refuses when stale).
4. **Capabilities** (`app/src/agent/capabilities/*.js`): one module per domain. Indicator writes go only through Indicators' interface `app/src/components/chart/builder/agentMutations.js`.

---

## 2. Completed work

### Gate B (Phase 0): safety + spend control — LIVE in production
- **Wrong-action regressions are fixed and railed:** "open swing", "remove momentum" and "pull up amzon" no longer mutate the wrong thing (`nl/collisions.js`, guards in `capabilities/board.js`, `layout.js` and `indicatorEdits.js`, `nl/tickers.js` near-ticker suggestions).
- **Spend ledger (`budget.py`):**
  - Agent cap **$5/day**, plus a read-only stop when UCT's shared catalyst ledger reaches **$15/day**. Owner Option D: a combined potential of $20/day. **Neither is site-wide.**
  - At most 2 model calls per request. Fails closed.
  - `GET /api/agent/budget` shows the state.
- **Rate limits (`limits.py`):** 20/min and 300/h per member; 1 in flight per member; 120/min global. Configurable by env (`UCT_AGENT_RATE_*`, `UCT_AGENT_INFLIGHT_*`). Deterministic commands are never limited.
- **Migration:** 4 additive SQLite tables in `uct_agent.db`: `agent_spend`, `agent_requests`, `agent_rate_events`, `agent_inflight`. They are created on first use (idempotent DDL).
- **Record:** `docs/agent/conversational-intelligence/GATE-B-PRODUCTION-RECORD.md`:

  | Service | Deployment | Status |
  |---|---|---|
  | web | `27341953` | SUCCESS |
  | worker | `0b385fc6` | SUCCESS |
  | bars-api | `fc11318e` | SUCCESS |
  | flow-worker | `bd55abab` | SKIPPED, as classified |

### Gate C (Phase 1): conversation — candidate ready, NOT released
- **Session memory** (`app/src/agent/memory.js`): result sets in display order, subjects (chart/indicator), last change, member corrections. 30-min TTL; invalidated when the board changes. In-page only, never persisted. `forModel()` → `context.conversation_memory`.
- **References** (`app/src/agent/references.js`): "open the third one", "compare it to the others", "do the same on the right one", "it" = the chart this chat changed.
- **In-place indicator edit:**
  - `indicator.update` in `capabilities/indicatorEdits.js`: "make it a 9", "change that to an SMA", "change the 20 to a 50". Ambiguity is asked about in legend names, never guessed. A stale target is refused.
  - It is backed by Indicators' **`setInputs`** in `agentMutations.js`, approved by INDICATORS.
- **MA defaults** (owner): EMA for 8/9/10/20/21, SMA for 50+. Nothing inferred for unlisted lengths. Explicit words win. An edit keeps the existing type.
- **Routing:** sturdier fallback and a `refresh` list (`routing.js`). `chart.compare` reuses the current chart.
- **Model instructions:** one line in `turn.py` describing `conversation_memory`.
- **Results:** nine-conversation comparison, Gate B 0/9 vs Gate C 9/9 conversations; 35/35 steps; WRONG 0 on every eval set. See `GATE-C.md` and `gateC-compare-*.json`.
- **Admin acceptance script** (24 steps, including manual workspace changes): `GATE-C-ACCEPTANCE.md`.

---

## 3. Branches and SHAs

### Remote (on origin)
| Branch | SHA | What |
|---|---|---|
| `handoff/agent-gate-c-2026-10-13` | the docs commit on top of `3191545b71` | **this handoff**: candidate + this file + A1 integration test attachments |
| `master` = `production` | `b80e0bf818` (at handoff) | production |
| `feat/indicators-a1` | `2928cfc55e` | **Indicators-owned** A1 candidate, draft PR #325. Not ours: never push to it. |

### Local only (old PC). Also in the bundle `C:\Users\blake\uct-agent-handoff\agent-local-branches-2026-10-13.bundle`
| Branch | SHA | Worktree | Status |
|---|---|---|---|
| `release/agent-gate-c-rc` | `3191545b71` | `C:\w\aconvc` | **the candidate** (also on the handoff branch) |
| `release/agent-gate-c-rc-pre-reword` | `561bbfce4f` | — | the same tree before a commit title was reworded; keep for reference only |
| `rollback/agent-gate-c-v2` | `c06d45f01b` | `C:\w\acrb2` | 6 reverts of `3191545b71`; tree = `b445c85440` (verified) |
| `rollback/agent-gate-c` | `6e10ba24e3` | `C:\w\acrb` | **obsolete**: reverts the pre-reword SHAs |
| `rollback/agent-gate-b` | `2a32b9b633` | `C:\w\aconv` | 13 reverts of Gate B; tree = `2d4c93293c` |
| `release/agent-gate-b` | `c84c9ca7c2` | `C:\w\aconv` | released; = what production carried |
| `feat/agent-conv-gate-c-on-prod` | `e8e4985352` | — | superseded by the candidate (all patches are in it) |
| `tmp/gatec-on-a1` | `596f7ebd45` | `C:\w\a1gc` | scratch: Gate C rebased on A1 `2928cfc55e` (integration proof) |
| `docs/agent-intelligence-audit` | `9af870cf31` | — | **unique**: the 2026-10-13 architecture audit (docs only, 7 files) |
| `fix/agent-stabilization` | `2da49d9039` | `C:\w\agent-p1` | 1 commit not matched by patch-id in master (`a61d66f0e4`, 10-11); probably superseded by the stabilization integration that shipped. Kept in case. |

Uncommitted at handoff:
- the A1 integration **scratch tests** in `C:\w\a1int` and `C:\w\a1gc`. Copies are committed on the handoff branch under `docs/agent/conversational-intelligence/a1-integration/*.txt`.
- Every other Agent worktree is clean.

Other local Agent branches (`feat/agent-simple-conversations`, `feat/agent-nl-intent-impl`, `feat/agent-context-p1`, `feat/agent-breadth-intelligence`, `feat/agent-ux-nl-rc`, `fix/agent-nasdaq-breadth`, `fix/agent-routing-layout-stabilization`, `fix/agent-stabilization-integration`) are **fully contained in master**; nothing to preserve.

---

## 4. Pending approvals and tests

1. **⚠ Gate B production smoke test (owner, admin session). A prerequisite for Gate C.** One authorised paid Haiku 4.5 call:
   1. Agent panel → one non-instant request (e.g. "what's driving semis this week?"); about $0.01, worst case about $0.03.
   2. Open `GET /api/agent/budget`. Expect: `cap_usd: 5`; `calls.settled ≥ 1`; tokens > 0; `models: ["claude-haiku-4-5"]`; `site.cap_usd: 15`. This confirms that the 4 tables exist and that the ledger settles against real usage.
   3. Free, instant: "show me my strongest stocks". This is the RS Rank production-coverage check, vocabulary question 1.

   Claude must not make this call: there is no local key, and production secrets must not be retrieved.
2. **Gate C release:** needs the owner's **separate explicit approval**. Not given.
3. **Section A vocabulary:** stays **disabled**. Owner answers are still needed; see `VOCABULARY-VERIFICATION.md`.
   - Q1: RS Rank production coverage, pending the smoke step above.
   - Q5: rows lagging the latest session.
   - Q6: IPOs with fewer than 252 sessions as new 52-week highs.
   - Q7: describing MA answers as "as of the latest completed session" unless the live tier applied.

   Already decided:
   - an unspecified "20" = EMA20;
   - never claim 200-day support (no catalog field);
   - a new 52-week high = intraday high, with closing-high requests distinguished (no catalog field exists for them).

   No numeric thresholds.
4. **Paid-AI-paths follow-up:** a **separate** security/cost project, not Agent work. See `docs/agent/conversational-intelligence/FOLLOWUP-PAID-AI-PATHS.md`. About 80 paid call sites sit outside the two budgets, and **two unauthenticated paid paths** are the priority: `api/routers/earnings.py` debug ping, and the `transcripts.py` route. Do not fix these without the owner scheduling it.

### Gate C tests (on `561bbfce4f`; the reword left the tree identical, `8441c9da0a`)
| Check | Result |
|---|---|
| Full frontend suite (`npx vitest run`) | 3,356 files / 46,186 tests passed. **7 files fail, all identically on production `b445c85440`** (list below). |
| Agent eval (layer A) | WRONG 0 on dev, heldout, adversarial, heldout2 and adversarial2. Gate B safety, Gate C conversation/indicator, memory, `setInputs` and census tests: 76/76 |
| Agent backend (`pytest tests/test_uct_agent*.py`) | 576 passed |
| Production build (`npm run build`) | OK |
| flow-worker coverage (`python tools/flow_worker_watch_coverage.py`) | OK, exit 0 (flow-worker not affected) |
| Secret / temp-file scan of the release diff | clean (39 files, all in the expected areas) |

### Known baseline failures (fail the same on production, not ours)
- Frontend:
  - `targetScriptReport.measure`
  - `panelContract.rail` (TERM-024 a)
  - `journal-2-0 … exportFormats.roundtrip`
  - `fidelityCarryovers.roundtrip`
  - `iteratorGlobalFloor`
  - `formControls.terminal`
  - `utils/jsonFetcher`
- Load-sensitive timeouts: `EvidenceTab.doors` and some others pass when run alone.
- Backend: 5× `test_definition_concierge`, 1× `test_notebook_earnings_prep`, 1× `test_ai_search_briefings::test_pass_budget_stops_the_sweep_without_stamping`.

### Gate C release footprint
- 39 files:
  - `app/src/agent/**`;
  - `app/src/components/chart/builder/agentMutations.js` + `.inputs.test.js` (Indicators-owned, approved);
  - one row in `controlDoorCensus.test.js`;
  - `api/services/uct_agent/turn.py` (1 line);
  - docs.
- **No migration:** no schema, no env, no stored preferences.
- Services:
  - **web** (via promote);
  - **worker** and **bars-api** redeploy because they watch `api/**` (harmless);
  - **flow-worker** not affected.

---

## 5. Safety constraints (standing; they apply to the new session)
- **Never push, merge, or deploy without the owner's explicit approval.** Gate C has **no** release approval yet. Push only non-production branches, and only when asked.
- **No paid AI calls** and no new infrastructure. Never retrieve production secrets, change model credentials, or print API keys.
- The Agent stays **admin-only**. Don't impersonate an admin session. Don't expand member access.
- **Indicators owns** indicator behaviour and persistence (`app/src/components/chart/**`); the Agent owns interpretation and orchestration (`app/src/agent/**`). Shared-file changes need INDICATORS' review. Don't change MI/BREADTH/INDICATORS calculations without coordination.
- Never print real market values: counts, dates and pass/fail only. Never route a denied production read through another session.
- Shared-origin `localStorage`: delete exact keys only.
- Never modify Main Trading, Positions or layout 109 in production.
- **Railway rollbacks don't hold here.** Roll back by pushing a revert through guard → master deploy gate → promote, then check the promote run's **`promoted`** field, not just its status.
- Respect the deploy freeze, **Wednesday 09:00–11:00 ET** (`python tools/deploy_freeze.py`), unless the owner explicitly overrides it.
- The pre-push guard (`python tools/pre_push_guard.py`) must run from a **Railway-linked** worktree, and its exit code must be read directly, never through `| tail`.
- Keep Gate B and Gate C release boundaries separate. Never put Gate C in another release, and never put Indicators A1 in a Gate C release.
- Section A stays disabled. No unapproved numeric thresholds.
- Never use bare `git stash`; never `cp` into a worktree path without checking for symlinks (shared `node_modules`).

---

## 6. Relationship with the Indicators project (INDICATORS session)
- **Boundary:** INDICATORS owns indicator behaviour and persistence, plus its Undo stack (`indicatorHistoryStore.js`). AGENT owns interpretation and orchestration, plus its own exact Undo. The Agent writes indicators **only** through `agentMutations.js`.
- **The Agent's chart door:** ChartWidget `api.agent.commit` → `onOptsChange`. It is **never** recorded on the member's indicator Undo stack. Not `applySettings`; the ChartPane comment was corrected in A1.
- **A1** (INDICATORS: indicator Undo/Redo, hide-not-delete, layout-open Undo toast, …) is candidate `2928cfc55e` on `origin/feat/indicators-a1`, draft PR #325. It is **not** in production. The owner said: never merge PRs.
- **Integration with A1 — owner-approved for release readiness (2026-10-13):**
  - Agent ops stay off the member Undo stack.
  - Member Undo/Redo refuses rather than overwriting Agent changes.
  - Independent changes keep both Undos exact.
  - Layout notifications stay accurate. INDICATORS fixed a stale "Switched to …" toast in `1311765c84`.
  - Gate C rebases cleanly onto A1. The combined suite passed 5,278 tests.
  - Test sources: `docs/agent/conversational-intelligence/a1-integration/*.txt`. To re-run, copy them back to their `app/src/...` paths (names in each file header) on a Gate C + A1 tree.
- **Landing order:** either is clean. **Whoever lands second rebases.** Gate C's footprint in Indicators' area is only the approved `setInputs` (`agentMutations.js`, its test file, one census row). If either side changes that code, re-run the integration tests.

---

## 7. Relevant files and documentation
- `docs/agent/conversational-intelligence/`:
  - `DESIGN-P0-P1.md`, `BASELINE.md`
  - `GATE-B.md`, `GATE-B-BUDGET.md` (Option D), `GATE-B-RELEASE-READINESS.md`, `GATE-B-PRODUCTION-RECORD.md`
  - `GATE-C.md`, `GATE-C-ACCEPTANCE.md`
  - `VOCABULARY-PROPOSALS.md`, `VOCABULARY-VERIFICATION.md`
  - `FOLLOWUP-PAID-AI-PATHS.md`
  - `gateC-transcripts/`, `gateC-compare-*.json`, `gateC-compare-harness.test.jsx.txt`
  - `a1-integration/`
- `docs/agent/` (older milestones): `CAPABILITY-CONTRACT.md`, `LATENCY.md`, the M1–M3 checklists, the breadth contracts.
- Code:
  - `app/src/agent/` — `useAgent.js`, `memory.js`, `references.js`, `fastPath.js`, `routing.js`, `executor.js`, `policy.js`, `runtime.js`, `capabilities/`, `nl/`, `contract/manifest.golden.json`;
  - `api/services/uct_agent/` — `turn.py`, `budget.py`, `limits.py`;
  - `api/routers/uct_agent.py`.
- Key tests:
  - `app/src/agent/agentEvalBaseline.test.js` (layer-A eval; corpus + held-out fixtures in `__fixtures__/nlIntent/`);
  - `agentGateBSafety.test.js`, `agentGateCConversations.test.jsx`, `agentGateCIndicators.test.jsx`, `agentMemory.test.js`;
  - `tests/test_uct_agent_spend_limits.py`.
- Release tooling: `tools/pre_push_guard.py`, `tools/deploy_freeze.py`, `tools/flow_worker_watch_coverage.py`; `.github/workflows/master-deploy-gate.yml`, `promote-production.yml`; the LEDGER in `docs/terminal-research/00-program-control/LEDGER.md`.

---

## 8. Next five recommended actions for the new session
1. **Recover and verify** (commands below). Check that the handoff branch's parent equals `3191545b71`. Install deps. Run the Agent suites (`npx vitest run src/agent`, `pytest tests/test_uct_agent*.py`). Do **not** start new development.
2. **Wait for the owner's Gate B smoke result** (section 4.1); don't poll for it. Record `/api/agent/budget` (counts only, no market values) in `GATE-B-PRODUCTION-RECORD.md`, and the RS Rank coverage outcome in `VOCABULARY-VERIFICATION.md` Q1.
3. **When, and only when, the owner approves the Gate C release:**
   1. rebase `3191545b71` onto the then-current production. It is behind `b80e0bf818` now; that has no file overlap, and `merge-tree` is clean.
   2. re-run the full frontend suite, the Agent backend tests and the build; compare against the baseline failures above.
   3. `flow_worker_watch_coverage.py`, `deploy_freeze.py`, then the pre-push guard from a Railway-linked worktree.
   4. push master → master deploy gate → promote, checking **`promoted`**; verify web/worker/bars-api deployments and the flow-worker classification.
   5. rebuild the rollback branch against the released SHA.
   6. the owner runs `GATE-C-ACCEPTANCE.md`.
4. **Coordinate with INDICATORS** on the A1 (PR #325) vs Gate C landing order. Whoever lands second rebases. Re-run the A1 integration tests if `agentMutations.js`, the Undo store, ChartWidget's agent adapter or the layout toast change.
5. **Section A vocabulary, after the owner's answers** to Q1/Q5–Q7: implement it as data (concept → field + operator, no thresholds beyond the above/below sign) with an Assumptions line in replies, behind the normal gates. Keep the paid-AI-paths follow-up separate unless the owner schedules it.

---

## 9. Recovering the work on the new PC (PowerShell)

```powershell
# 1. Clone (or fetch into an existing clone) and check out the handoff branch
git clone https://github.com/unchartedterritory5995-cyber/UCT-Dashboard.git C:\w\uct
Set-Location C:\w\uct
git fetch origin
git switch -c handoff/agent-gate-c-2026-10-13 --track origin/handoff/agent-gate-c-2026-10-13

# 2. Verify the candidate: the handoff head's parent must be the Gate C RC
git rev-parse HEAD~1                       # expect 3191545b714b70fd370ec4f16d5dcd2fa3ea46e3
git log --oneline b445c8544025e0c58bf0f2d33d2b16e918f26d95..HEAD   # 7 lines: 6 Gate C + 1 handoff docs
git branch release/agent-gate-c-rc 3191545b714b70fd370ec4f16d5dcd2fa3ea46e3

# 3. Frontend deps + Agent suites
Set-Location C:\w\uct\app
npm ci
npx vitest run src/agent
Set-Location C:\w\uct

# 4. Backend venv + Agent tests (Python 3.12)
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider (Get-ChildItem tests\test_uct_agent*.py).FullName

# 5. Optional: restore the old PC's local-only branches from the bundle (copy the file over first)
git bundle verify C:\uct-agent-handoff\agent-local-branches-2026-10-13.bundle
git fetch C:\uct-agent-handoff\agent-local-branches-2026-10-13.bundle "refs/heads/*:refs/remotes/oldpc/*"
git branch --list -r "oldpc/*"
#   e.g. the architecture audit:  git branch docs/agent-intelligence-audit oldpc/docs/agent-intelligence-audit

# 6. Rebuild the Gate C rollback branch (whenever needed; always against the SHA actually released)
#    <BASE> = production before the release, <RELEASED> = the released Gate C head
git switch -c rollback/agent-gate-c <RELEASED>
git revert --no-edit <BASE>..<RELEASED>
git diff --stat <BASE> HEAD                 # must print nothing
#    For the current candidate: BASE = b445c8544025e0c58bf0f2d33d2b16e918f26d95, RELEASED = 3191545b714b70fd370ec4f16d5dcd2fa3ea46e3

# 7. Release tooling needs a Railway-linked worktree (owner sets up the Railway CLI login/link; never copy secrets)
#    python tools\flow_worker_watch_coverage.py ; python tools\deploy_freeze.py ; python tools\pre_push_guard.py
```

The bundle file is on the old PC at `C:\Users\blake\uct-agent-handoff\agent-local-branches-2026-10-13.bundle` (about 280 KB). Copy it to the new PC, e.g. `C:\uct-agent-handoff\`. It needs `origin/master` history, so restore it into a fresh clone, as above.
