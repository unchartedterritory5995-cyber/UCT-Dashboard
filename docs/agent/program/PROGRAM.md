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

## Owner decisions 2026-11-02 (evening)
- APPROVED: the narrowly scoped deploy-gate rail amendment (promotion-gate:no Agent CI workflows allowed, pinned by name; gate coverage intact) — landed on agent/int 3356d5a4b2.
- APPROVED: ONE combined Wave 1 release candidate (F-16/F-23 #704, W1-A #712/#713/#714, W1-B #707/#711/#715, W1-C #705/#706/#708, Agent CI). No separate deploys. After the merges: combined integration run + independent QA on the agent/int head, then a release manifest (commits, CI, security results, proposed flags, rollback plan, GO/HOLD) before any production promotion.
- On promotion: admin-only `UCT_AGENT_STREAM`, quote kinds and `UCT_AGENT_NEWS` only after their specific checks pass; `bars.daily` and `UCT_AGENT_SCAN` only with confirmed F-16/F-23 protections and green isolation rails in the combined RC, followed by production verification.
- Planner v2 (`UCT_AGENT_PLANNER=v2`) stays OFF pending real-model evaluation and separate approval. No paid evaluations, no extra spending, no member rollout, no flow-worker restart.
- MANDATORY after deployment (this and every future major Agent release): Phase 1 Claude-led live production testing and Phase 2 owner hands-on acceptance (Levels 1–5, ≥ 30 prompts, scorecard) — `LIVE-TESTING.md` and `OWNER-ACCEPTANCE.md`. Wave 1 is "technically deployed" after Phase 1 and "owner-accepted" only after the owner's own session and review; serious execution / financial-accuracy / permission / Undo failures block acceptance; unrelated safe development continues meanwhile.

- 2026-11-03 02:30Z (via agent-lead's session, owner's choice): PR #717 (separate "scans release") CLOSED; scans ship in the combined Wave 1 RC; #716 (scan routing, agent-sc GO, agent-qa GO, AUDIT review APPROVE) merges into agent/int last, with one SAT-1 capture re-bless (d26 moves to screener+agent). The owner explicitly chose to keep `UCT_AGENT_SCAN=1` in production (set 01:52Z, admin-only) until the RC ships F-16 enforcement — recorded as an accepted interim exposure, not an oversight. agent-lead's session has ended; the Agent project continues in this integrator session.


## Overnight authorization 2026-11-03 (owner; verbatim intent recorded)
- **Wave 1.1 = Agent-only repairs of the Phase 1 live findings** (LT-1, LT-3, LT-4, LT-8, LT-9, LT-10, LT-11, LT-12; F-16/F-23 isolation re-check; regression tests that reproduce the production failures; investigation of the pre-enabled production flags; read-only verification of `charts_active_template`). One consolidated RC. **Conditional overnight deploy** allowed ONLY if all eight conditions hold (fix-only scope; independent review approves the combined RC; all Agent/security/isolation/master gates pass; no unrelated change, no security weakening, no migration, nothing destructive; no new flag or member access; gate idle + synced with latest master; rollback verified; compatible with current production config). Otherwise HOLD, preserve the RC, continue safe work. After deploy: verify commit/health/auth/budgets/flags, rerun the failed live scenarios within the production Agent budget, never touch real user data. Wave 1.1 is NOT owner-accepted overnight.
- **Wave 2 starts now in parallel** on its own integration branch `agent/int-w2` (from master e6740b5b08): Builder A intelligence (NL/multi-turn, planner v2 eval readiness, multi-step planning, schema-constrained args, deterministic evals; v2 stays OFF), Builder B market intelligence (research capability with citations, historical analysis/comparison, grounded TA workflows, follow-ups, freshness; licensing + F-16 boundaries), Builder C website operations (Agent beyond Charts via canonical APIs, Explain/Show/Do, cross-feature workflows + Undo). Integrator keeps PROGRAM/BOARD/EVAL, CI, independent review, merges green reviewed PRs into `agent/int-w2`, prepares bundled RCs. **Not authorized overnight:** deploying Wave 2; planner v2 ON; the $21 paid eval; spending increases; member access; flow-worker; isolation weakening; destructive tests; unrelated production changes.

### Wave 1.1 / Wave 2 worktrees
| Worktree | Branch | Owner | Scope |
|---|---|---|---|
| C:/w/w11-a | agent/w11/args | repair-a | LT-3 (args off-schema on live model), LT-1 (empty-board add), LT-9 (rename), LT-10 (nonsense → clarify) |
| C:/w/w11-b | agent/w11/routing-f16 | repair-b | LT-4 (indicatorAlerts routing + false-claim wording), LT-8 (hidden-field phrase in refinement → F-16 sentence), LT-11 (public alternative), LT-12 (next report date), F-16/F-23 isolation re-check |
| C:/w/w2-int | agent/int-w2 | integrator | Wave 2 integration |
| C:/w/w2-a | agent/w2/intelligence | w2-a | Builder A |
| C:/w/w2-b | agent/w2/market | w2-b | Builder B |
| C:/w/w2-c | agent/w2/webops | w2-c | Builder C |

## Activation checklist (admin-only; owner sets flags; order is mandatory)
1. `UCT_AGENT_STREAM=1` — after production flags are verified.
2. `UCT_AGENT_DATA=1`, `UCT_AGENT_DATA_KINDS=quote,quotes,instrument.resolve` — after RC1.
3. add `bars.daily` — only after F-23 (#666 content) is on master.
4. `UCT_AGENT_NEWS=1` — after the #692 QA verdict is recorded.
5. `UCT_AGENT_SCAN=1` — only after F-16 (#654/#657/#661 content) is on master, isolation audit cells 23/24 closed, rails green, and an independent verification is recorded in BOARD.
6. `UCT_AGENT_PLANNER=v2` — only after the sealed-set result meets target with 0 FAIL and the owner approves the model.
7. `UCT_AGENT_ISOLATED`, `UCT_AGENT_NL1`, `AGENT_BREADTH_CURRENT` — stay OFF in Wave 1.
