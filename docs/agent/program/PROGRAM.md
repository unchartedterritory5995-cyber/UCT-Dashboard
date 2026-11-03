# UCT Agent program — PROGRAM.md (the durable record)

**Authorized by the owner 2026-11-02** (Wave 1 execution directive). This file, `BOARD.md`, `EVAL.md` and `contracts/` are the record. Messages between sessions are notices only. Supersedes `README.md`, `STARTUP-PROMPTS.md` and the per-role status files for Wave 1 onward (kept for history).

## Vision (unchanged)
UCT Agent is the intelligent interface to the whole UCT website: it understands trading language, operates the site's canonical capabilities, answers with grounded market data, and carries out multi-step workflows with approvals, receipts and Undo. The Agent proposes; UCT executes. No engine is duplicated.

## Plan of record
`docs/agent/audit-2026-11-02/` (Deliverables 1–9). Wave 1 = Deliverable 5 + 9.

## Wave 1 packages and owners

| Package | Owner session | Branch | Worktree | Scope |
|---|---|---|---|---|
| W1-A Planner | builder-a | `agent/w1/planner` | `C:/w/w1-a` | tool-use execution loop (`UCT_AGENT_PLANNER=v2`, default off), full catalog via deferred tools, per-step sanitize/approval, multi-step turns, "undo all of that", eval harness prerequisites (effort switch, cost-guard rows), free deterministic tests |
| W1-B Operator | builder-b | `agent/w1/operator` | `C:/w/w1-b` | time-anchored drawings, dated-close phrasing on `stock.dailyBars`, indicator alerts kind, KNOWN→ELIGIBLE chart settings, generic `widget.setOption`, `chart.replay` |
| W1-C Data + scan | builder-c | `agent/w1/data-scan` | `C:/w/w1-c` | server-persisted `lastScreen` refinement state, fundamentals/earnings/news.company/themes wired to capabilities, index/commodity/crypto kinds (dedicated, licensed, or honest decline), legacy `stock.js`/`alert.js` quote reads moved onto the gateway |
| W1-SEC F-16/F-23 | sec-integrator | `agent/w1/f16-f23` | `C:/w/w1-sec` | bring #654, #657, #661, #666 onto current master by MERGE (no history rewrite of other sessions' branches), resolve conflicts, run the isolation/F-16/member rails, open one PR into `agent/int` that supersedes the four |
| W1-I Integration | integrator (this session: AUDIT [549088]) | `agent/int` | `C:/w/w1-int` | PROGRAM/BOARD/EVAL, CI, merges, RCs, activation checklist, independent review per package PR, coordination with other trains |

Ownership = the paths each package touches, listed in `BOARD.md` per task. Anything outside those paths needs the integrator's OK in the PR. `tools/agent_ownership_check.py` roles are historical; the BOARD is the authority for Wave 1.

## Standing rules (owner's restrictions, verbatim in effect)
- No paid model evaluations without separate owner authorization. No production planner model change without separate approval. Spending controls are verified first (see `EVAL.md` §0).
- Do not activate scanning (`UCT_AGENT_SCAN`) until F-16/F-23 protections are merged and independently verified.
- No merge or deploy to production without the normal release approvals (guard → master deploy gate → promote). Builders never merge. The integrator merges into `agent/int` only; RCs to master need the owner's go.
- Do not restart flow-worker. Do not expand Agent access to members (`require_admin_dark` stays). Do not weaken ADR-005 isolation, F-16 hiding, or Massive licensing wording.
- Do not change production CI requirements (the master deploy gate) without separate approval. The new `agent-ci.yml` is additive.
- Everything new ships dark behind a default-off server flag or an admin-only path.

## Machine rules
- Worktrees `C:/w/w1-*` share `app/node_modules` by junction to `C:/w/txlinks/app/node_modules` (lockfile identical to master on 2026-11-02). Never run `npm ci`/`npm install` in them.
- Python: `C:/Users/blake/projects/UCT-Dashboard/.venv/Scripts/python.exe`.
- Targeted test runs (`npx vitest run <files>`, `pytest <files>`) are free to run any time. FULL Agent suites go through `python tools/agent_suite_lock.py run --who <session> -- <cmd>` (2 slots). Never run gate shards in parallel locally. CI does the heavy runs.
- Don't touch worktrees you didn't create. Don't print real market values into a session.

## How work flows
1. Builder reads PROGRAM.md, its BOARD rows, EVAL.md. Works on its branch. Commits small, pushes often.
2. One PR per capability group or kind group into `agent/int` (target ≈ 3–4 PRs per package in Wave 1). The PR lists: BOARD rows closed, tests run (counts), files outside the package's paths (if any, why).
3. Integrator reviews with an independent review subagent (diff only, security checklist), merges in dependency order, regenerates the golden manifest if a capability registered, keeps `agent-ci` green on `agent/int`, updates BOARD.
4. RC1 (operator + data, flags per the activation checklist) and RC2 (planner v2) go to master as combined release candidates with a prepared revert PR, on the owner's go.

## Coordination with other trains (Indicators, News, Chart IQ, Charts)
- Agent branches are `agent/w1/*`; they do not edit `app/src/components/chart/**` except the two items the owner allowed for Wave 1 (`chartSettingsDescriptors.js` ELIGIBLE rows; an alert kind over `hooks/useIndicatorAlerts.js`), each announced to the Indicators/Charts sessions in the PR.
- RC windows are announced a day ahead in BOARD.md and by SendMessage; the Agent RC waits while another train's RC is in the master gate.
- Indicators RC #701 and PR #516 (on hold) are untouched.

## Activation checklist (admin-only; owner sets flags; order is mandatory)
1. `UCT_AGENT_STREAM=1` — after production flags are verified.
2. `UCT_AGENT_DATA=1`, `UCT_AGENT_DATA_KINDS=quote,quotes,instrument.resolve` — after RC1.
3. add `bars.daily` — only after F-23 (#666 content) is on master.
4. `UCT_AGENT_NEWS=1` — after the #692 QA verdict is recorded.
5. `UCT_AGENT_SCAN=1` — only after F-16 (#654/#657/#661 content) is on master, isolation audit cells 23/24 closed, rails green, and an independent verification is recorded in BOARD.
6. `UCT_AGENT_PLANNER=v2` — only after the sealed-set result meets target with 0 FAIL and the owner approves the model.
7. `UCT_AGENT_ISOLATED`, `UCT_AGENT_NL1`, `AGENT_BREADTH_CURRENT` — stay OFF in Wave 1.
