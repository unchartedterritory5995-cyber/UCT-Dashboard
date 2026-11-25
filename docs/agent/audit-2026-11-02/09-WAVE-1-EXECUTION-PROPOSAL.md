# Deliverable 9 — Wave 1 execution-ready proposal (final decision memo)

Prepared 2026-11-02 after the owner's review of the audit. Planning only. Every claim marked **verified** was checked in this session against the repository, GitHub or the published docs; **unverified** items say so and name who can verify them.

## 0. Verification results for the owner's ten requirements

| # | Requirement | Result |
|---|---|---|
| 1 | Planner models, pricing, caching | **Verified on the published pricing and caching pages (fetched today).** Sonnet 5.5: $2 in / $10 out, cache write $2.50 (5 m) or $4 (1 h), cache read **$0.10** (0.05x); Haiku 5.5: $0.10 / $0.50, cache read $0.01; Haiku 4.5 (today): $1 / $5, cache read $0.10. Minimum cacheable prefix: **512 tokens** for Sonnet 5.5 and Haiku 5.5, **4,096** for Haiku 4.5. Batch API: 50 % off. `tools/agent_eval_prices.json` already carries these numbers (verified 2026-10-16) and matches the page. Account availability of the two new models is checked by the runner with a free models lookup at run start; it has never been run because no key has been provisioned. **Latency is unmeasured** for any model (no paid probe has been authorized); the repo's `tools/agent_latency_probe.py` is built for exactly that at ≤ $0.70. |
| 2 | Evaluation design with explicit caps | §2 below. Phase A cap **$21** (expected ≈ $8); Phase B up to the remaining $54 of the $75. No paid call until the owner authorizes each phase. |
| 3 | Activation plan; F-16/F-23 before scanning; verify production flags | §4. **Production flag values could not be read by this session** (Railway reads are denied by the harness classifier). The repo's flag ledger does not list `UCT_AGENT_*` (they are gates, not visibility flags, by the ledger's own definition). One owner-run command verifies them (§4.1). |
| 4 | Faster parallel CI with equivalent coverage, benchmarked first | §5. Measured today's gate: Agent vitest step **913 s** (148 files; 665 s in tests, 148 s imports, 56 s environment) on a 4-vCPU runner with a fork pool capped at half the machine. Four-way sharding is projected at ~4–5 min wall per shard; the benchmark workflow runs on a branch and does not touch the production gate. |
| 5 | Substantial parallel packages, ownership, contracts, checkpoints, acceptance | §3 and Deliverable 5. |
| 6 | Independent security/integration review plus nightly real-model eval | §6. |
| 7 | Fewer handoffs, isolated worktrees, durable board, combined RCs, approvals kept | §3.4 and Deliverable 6. |
| 8 | Exact F-16/F-23, isolation, licensing, member-access status | §4.2. |
| 9 | #684 / #665 superseded by #692? | **Verified by git, not by description:** `git rev-list --count origin/master..origin/agent/lead/news-agent` = **0** and `…origin/feat/uct-news-agent-ask` = **0**. Every commit of both branches is already an ancestor of master (merged through #692 `d16867f344`). Closing them without merge loses nothing. The remaining differences between those branches and master are master's later commits, not missing content. |
| 10 | Two-week plan with fallback, critical path, success criteria | §7. |

## 1. Planner benchmark design (no production model switch)

**What is compared:** the production planner path (`run_turn`, legacy mode, routed manifest, json_schema envelope) with only the model swapped. This isolates the model's effect. The tool-use loop (Deliverable 3 §3) is a separate branch build evaluated in Phase B.

**Prerequisites on an eval branch (code, not production; never merged before the owner's model decision):**
- `turn.py` sends no `effort` and `MAX_TOKENS = 2048`. Sonnet 5.5 and Haiku 5.5 run adaptive thinking by default and thinking tokens count against `max_tokens`, so a bare swap risks truncated JSON. Add `UCT_AGENT_EFFORT` (default unset; `low` for the probe) and raise the ceiling to 4096 when effort is set. `agent_eval_run.py` already has `--effort`.
- `api/services/narrative_cost_guard.py` prices Sonnet 5.5 and Haiku 4.5 but **not Haiku 5.5** (falls back to the most expensive known rate, which is safe but overstates). Add the row.
- Sonnet 5.5 rejects forced `tool_choice` and `temperature`; the current call sends neither. Structured output (`output_config.format`) is supported.

**Sets (all exist in the repo):** `dev-nl1.json` (39 cases / 46 turns, captured free by `agentNl1EvalCapture.test.js`), `heldout-v1.json` (196), the 14-case live batch (`agentLiveCapture.test.jsx`), `sealed-v3.json` (200 cases / 229 turns, hash-locked, never scored). The 57-case Batch 6 benchmark of 2026-10-08 is **not** in the repo as a reusable file; its successor is the live batch plus dev-nl1.

**Scored on:** the Deliverable 7 outcome classes (E/C/R good; U/X; W/H = FAIL), plus calls per turn, tokens, cache read share (`cache_read_input_tokens`), cost, and latency (plain and streamed).

## 2. Paid evaluation plan with explicit caps

| Phase | What runs | Models | Est. cost | **Hard cap (`--max-usd`)** | Authorization |
|---|---|---|---|---|---|
| A0 | Free: capture bodies, dry-run size/cost estimates, account models lookup (no tokens billed; needs the eval key provisioned) | — | $0 | — | key provisioning |
| A1 | dev-nl1 46 turns, legacy mode | Haiku 4.5 (baseline), Sonnet 5.5 @ low, Haiku 5.5 @ low | ≈ $0.4 + $0.8 + $0.05 | **$3 per model, $9 total** | separate owner OK |
| A2 | heldout-v1 196 cases, legacy mode | the two best of A1 | ≈ $3.1 (Sonnet) + $0.2 (Haiku 5.5) | **$10 total** | separate owner OK |
| A3 | latency probe, 20 bodies, plain + streamed | the A2 winner | ≈ $0.5 | **$1** | with A2 |
| **Phase A total** | | | **≈ $8** | **$21** | |
| B1 | sealed-v3 229 turns, once, on the chosen model (baseline before the planner change) | winner | ≈ $4 | $8 | after A |
| B2 | tool-use loop branch: dev-nl1 + Wave 1's 20 acceptance prompts + 14 live batch, iteratively (≤ 5 runs) | winner | ≈ $2–3 per run | $20 | after the loop builds |
| B3 | sealed-v3 on the loop build, once; then nightly runs ≤ $5 until wave close | winner | ≈ $4 + ~$15 | $26 | after B2 passes |
| **Phase B total** | | | **≈ $40** | **$54** | |
| **Wave 1 total** | | | **≈ $48** | **$75** | |

Rules already enforced by the runners: a separate eval key that is not the production key; the models lookup before the first call; worst-case reservation before every call; stop at the ceiling; replies never printed; no execution against production or member data.

## 3. Wave 1 packages, ownership, contracts, checkpoints

### 3.1 Packages (from Deliverable 5, unchanged in scope)

| Package | Owner | Branch / worktree | Contract it codes against | Checkpoint |
|---|---|---|---|---|
| **W1-A Planner + eval** (1.1–1.3) | Builder A | `agent/w1/planner`, fresh worktree from master | `STEP-1.md` (the step protocol: tool call → browser step → tool result), frozen day 1 | A1/A2 results (day 3), loop passes dev-nl1 (day 8), B3 (day 11) |
| **W1-B Operator** (1.5–1.10: anchored drawings, dated close UI, indicator alerts, settings rows, widget options, replay) | Builder B | `agent/w1/operator` | the registry (`registerCapability`, target kinds) as it is; Indicators' `agentMutations`/`useIndicatorAlerts`; drawings store | PR per capability group (≈ 3 PRs), first merge day 3, done day 8 |
| **W1-C Data + scan** (1.11–1.14: refinement state, 4 kinds wired, index/commodity/crypto kinds, legacy quote path to gateway) | Builder C | `agent/w1/data-scan` | MD-1 v1.5 envelopes, SC-1/SC-2 | PR per kind group, done day 8 |
| **W1-I Integration** (CI benchmark and `agent-ci.yml`, `agent/int` reset, BOARD/PROGRAM docs, two RCs, activation checklist, independent review per package) | Integrator | `agent/int` worktree | — | RC1 day 7 (B + C, flags per §4), RC2 day 12–14 (A) |

### 3.2 Canonical API contracts (nothing new except STEP-1)
- Writers: unchanged; every W1-B capability commits through an existing product writer with read-back.
- Data: MD-1 envelopes; new kinds (index/commodity/crypto) are dedicated `kinds.py` entries with their own licensing-class rows.
- Planner: `STEP-1.md`, one page: request body (unchanged) + `steps[]` streaming protocol; browser answers each step with `{receipt | refusal | result}`; `sanitize_envelope`/`enforce_approval` applied per step; proposals pause the loop.

### 3.3 Integration checkpoints
- Day 1: `agent/int` reset to master (it is 263 commits behind; the four F-16/F-23 PRs are 299 behind and must be rebased); `agent-ci.yml` on `agent/**` pushes; BOARD.md seeded with every task above.
- Daily: integrator merges in dependency order (B, C additive first), golden regenerated, CI green, BOARD updated.
- Day 7 RC1 and day 12–14 RC2 to master through the normal guard → gate → promote path, each with a prepared revert PR and the flag list to turn off.

### 3.4 Process rules for the wave
- One PR per capability group or kind group (expect ~12 PRs in two weeks, not 130).
- No cross-session review per PR; the integrator spawns one independent review subagent per package PR, given the diff and no conclusion.
- Builders never merge, never touch `agent/int`, never edit another builder's paths; SendMessage for notices only; BOARD.md is the record.
- Approvals unchanged: confirm-risk and irreversible actions are proposed; the loop pauses on a proposal.

## 4. Activation plan and security status

### 4.1 Verify production flags first (owner-run, read-only, prints only the Agent flags)
The harness denies this session any Railway read. The owner can run it in this session with the `!` prefix:
```
! railway variables --service web --kv | grep -E "^(UCT_AGENT_|AGENT_BREADTH_)"
```
It prints only names and values of the Agent flags (no secrets). Until that runs, the activation table below assumes the code defaults (all OFF) and the 2026-11-02 session notes (OFF).

### 4.2 Exact status (verified)

| Item | Status | Evidence |
|---|---|---|
| F-16 (UCT ratings/scores/flow reachable through screener fields) | **OPEN for enforcement.** Owner ruling hides 26 fields; F-16-R (reconstruction from public inputs) accepted as residual by the owner. Enforcement PRs **#654** (server, ready), **#657** (client, draft), **#661** (QA rails, stacked) are open against `agent/int`, 299 commits behind master, unmerged. Isolation audit cells 23 (ranking) and 24 (count) stay OPEN until they merge. | `status/agent-qa.md:488-664`, `gh pr view 654/657/661` |
| F-23 (half-day "last completed session") | **OPEN**, fix in **#666** (+98/−8, open, unmerged, 299 behind). Affects `bars.daily`; not `quote`. | `status/agent-qa.md:440`, `gh pr view 666` |
| Model isolation (ADR-005) | PASS on the shipped RC (27+ audit cells; gateway dormant by default; isolated stamp; replay-as-note; marker strip) | `status/agent-qa.md` #596 verdict |
| Member access | PASS: non-admin paid member gets 403 before any provider call; unpaid 402; `tests/test_uct_agent_qa_member_refused.py` rails it | G4 verdict 2026-11-02 |
| Vendor licensing | Massive live quotes/aggregates are class **R**, Individual tier, display-only; MD-1 phrasing rules (never "live/now" on non-live data, "Not a real-time price", fund labelling) implement it; admin display is within the class. Member-facing display at rollout needs the owner's licensing confirmation (OI-03 still open in `provider_licensing_class.py`). | `api/services/provider_licensing_class.py:12-49` |
| News → Agent | code complete, dark; #692's "pending QA verdict + News re-run on the exact SHA" is **unverified** (not recorded in any status file) | App. F §2 |
| Quote wording | QA GO: FAIL = 0 on four held-out sets at #697 | `status/agent-qa.md` |

### 4.3 Admin-only activation sequence (flags are set by the owner; nothing here is automatic)

| Step | Flag(s) | Precondition | Earliest |
|---|---|---|---|
| 1 | `UCT_AGENT_STREAM=1` | none (behaviour-preserving transport) | after flag verification |
| 2 | `UCT_AGENT_DATA=1`, `UCT_AGENT_DATA_KINDS=quote,quotes,instrument.resolve` | QA GO #672/#697 (done); flags verified | after RC1 |
| 3 | add `bars.daily` to `UCT_AGENT_DATA_KINDS` | **#666 (F-23) merged** and the half-day test re-run on master | after RC1 if #666 lands in it |
| 4 | `UCT_AGENT_NEWS=1` | the #692 QA verdict recorded by agent-qa (or the owner's own admin smoke) | after RC1 |
| 5 | `UCT_AGENT_SCAN=1` | **#654 + #657 + #661 merged**, isolation audit cells 23/24 closed on master, F-16 rails green in CI | RC2 at the earliest; **not before** |
| 6 | `UCT_AGENT_ISOLATED`, `UCT_AGENT_NL1`, `AGENT_BREADTH_CURRENT` | stay OFF in Wave 1 | — |
| 7 | planner v2 (`UCT_AGENT_PLANNER=v2`, new flag) | Phase B3 sealed-set result ≥ target and 0 FAIL | RC2 |

Member access stays `require_admin_dark` throughout.

## 5. CI: parallel test architecture and the benchmark before any gate change

### 5.1 Measured today
Latest successful gate run 41538783394: Agent browser step **913 s** of a ~23-minute gate (148 files: 143 passed, 5 skipped; tests 665 s, import 148 s, environment 56 s, setup 24 s, transform 13 s). The vitest pool is `forks` capped at half the machine (`app/vite.config.js:273-299`); on a 4-vCPU `ubuntu-latest` runner that is 2 forks. Nothing runs on `agent/int`, and PR workflows on Agent branches run only the 1–3-minute guards.

### 5.2 Proposed shape (coverage-equivalent)
```
master deploy gate (serial, unchanged list minus one step):
   secret scans, shadowed definitions, VITE args, flag ledger, engine version, hygiene,
   discord goldens, production dependency smoke, UCT Agent SERVER tests (pytest, 1.1–1.4 min),
   + NEW: Agent CONTRACT SMOKE (golden manifest + agentContracts + agentCore + policy/runtime/undo files, ≤ 3 min)
   − REMOVED: the full Agent vitest run (913 s)

agent-ci.yml (new; on push to agent/** and on PRs into agent/int and master from agent/**):
   job pytest-agent (1.5 min)
   job vitest-agent, matrix shard 1..4:  npx vitest run src/agent src/components/chart/builder/agentMutations --shard=N/4
   job shard-union rail: the four shards' file lists concatenated must equal the unsharded file list (fails otherwise)
   job golden + ownership check
   required for merge into agent/int and for the RC PR into master
```
- The security rails (secret scan, isolation, member-refused, F-16 rails) run in both places: the pytest step stays in the gate; the browser-side rails run in the shards and are **required status checks on the RC PR**, so a master push cannot bypass them. Equivalence rail: a test that the set of Agent test files executed by the shards ⊇ the set the gate used to run, pinned to the file glob, not a count.
- Projection: 665 s tests ÷ 4 ≈ 170 s + import/env ÷ 4 ≈ 50 s + `npm ci` (cached, ~60–90 s) + checkout ≈ **4–5 min wall** per shard, 4 shards in parallel. Gate drops from ~23 min to ~7–8 min for every workstream.

### 5.3 Benchmark before changing anything
- `agent-ci-benchmark.yml` on the docs/CI branch, `workflow_dispatch` only, runs the matrix above three times and records per-shard wall time and the union rail. Zero effect on the production gate.
- Also run once with `--reporter=json` to capture per-file durations (the CI log has none today) for balanced shards later.
- Go/no-go for the gate change: median shard wall ≤ 6 min, union rail green, and the 143/5 pass/skip counts reproduced across shards. Only then is the gate edit proposed, as its own one-line PR.

## 6. QA: independent review and nightly evaluation

- **Independent review:** one review subagent per package PR, spawned by the integrator with the diff only; security checklist = admin gate, isolation (no raw isolated values in any model-bound field), F-16 field list, side effects (no `/api/live-prices` from Agent paths — new rail), approvals for confirm-risk actions, Undo exactness.
- **Security suite:** `tests/test_uct_agent_qa_*` (isolation layers, isolation audit, member refused, clock rails) stay required; F-16 rails (#661) become required once merged.
- **Nightly eval:** headless Task Scheduler job running `agent_live_batch.py` / `agent_eval_run.py` under `--max-usd 5` with the eval key, writing `EVAL.md` and `scores/eval-<date>.json`; a regression (any new FAIL, or task completion down > 3 points) becomes a BOARD task tagged `regression` before builders start.
- **Held-out discipline:** sealed-v3 scored at most twice in the wave (B1 baseline, B3 final); builders see dev sets only.

## 7. Timeline, critical path, fallback

### 7.1 Aggressive (two weeks, three builders)
```
Day 1   decisions 1–4 (§8); eval key; A0 captures; agent/int reset; agent-ci.yml + benchmark workflow on branch;
        BOARD seeded; B and C start; A writes STEP-1.md and the eval-branch prerequisites (effort flag, cost-guard row)
Day 2–3 A1/A2/A3 paid runs → model decision (owner) ──────────────────────────── CRITICAL PATH
Day 3–8 A builds the tool-use loop behind UCT_AGENT_PLANNER=v2; B and C land PRs; integrator merges daily
Day 5   CI benchmark result → gate-change PR proposed
Day 7   RC1 = B + C (+ #666 if rebased and green) → master → activation steps 1–4
Day 8–11 B2 iterations on the loop; B1 sealed baseline; B3 sealed final
Day 12–14 RC2 = planner v2 (+ F-16 PRs if rebased, reviewed and green) → activation steps 5 and 7; owner smoke
```
Critical path: eval key → Phase A → model decision → loop build → B3 → RC2. Everything in B, C, CI and the F-16/F-23 rebases runs in parallel and is not on it.

### 7.2 Realistic fallback (four weeks, two builders)
Same order; B and C are one builder in sequence (operator first); Phase A in week 1, loop in weeks 2–3, RC1 end of week 2, RC2 end of week 4. If the loop misses its B3 target, RC2 ships B + C + flags only and the planner stays on the current path with the better model (A2 winner) as a one-line env change, which is itself a measurable gain.

### 7.3 Measurable success criteria at wave close
- Task completion ≥ 85 % (E+C+R) on dev-nl1, heldout-v1 and the 20 Wave 1 prompts; **0 FAIL** on sealed-v3; execution gap ≤ 5 %.
- Single-step p50 ≤ 4 s and multi-step (≤ 5 steps) p50 ≤ 12 s in the latency probe; cost ≤ $0.02 single-step, ≤ $0.10 multi-step; cache read share ≥ 70 %.
- Coverage ≥ 85 % of the Charts page (Appendix C weighting).
- Gate median ≤ 8 min; Agent CI green on `agent/int`; shard-union rail green.
- Flags per §4.3 ON for admin, member rails green; F-16 cells 23/24 closed on master.
- BOARD.md shows every task closed with PR and eval evidence; EVAL.md has the dated baseline and final runs.

## 8. The concise decision memo

**Can start immediately, no additional approval (planning, free, non-production):**
- Seed `PROGRAM.md` and `BOARD.md`; write `STEP-1.md`; reset `agent/int` to master and rebase #654/#657/#661/#666 onto it (integrator action; no production effect).
- Add `agent-ci.yml` and `agent-ci-benchmark.yml` on a branch; run the benchmark (`workflow_dispatch`, no gate change).
- Free captures and dry-run cost estimates (A0 minus the models lookup); the eval-branch prerequisites (effort flag, cost-guard row), unmerged.
- Close #684 and #665 (verified fully contained in master).
- Owner runs the flag-verification command (§4.1).

**Requires spending or security approval:**
- Eval key provisioning and Phase A ($21 cap) — spending. Phase B ($54 cap) — spending, after A.
- Model change for production — after A2 and the owner's decision.
- Gate change (removing the Agent vitest step) — after the benchmark passes; repo-wide CI.
- Flag activations §4.3 — each a production change; scanning only after F-16/F-23 merge and the rails are green on master.
- Builder implementation (W1-A/B/C) — Wave 1 authorization.

**Runs in parallel:** W1-B, W1-C, CI benchmark, F-16/F-23 rebases and review, Phase A eval; W1-A's loop build runs in parallel with all of them once the model decision lands.

**What we should demonstrate at the end of Wave 1 (admin, `/charts`):** the owner types "find stocks above their 20 EMA with volume twice average, drop anything under $10, put the top five by three-month change on a new list, open the top two in the bottom row with my 9/20 EMAs, and save this as Momentum Review"; the panel streams each step, shows one approval card, completes on "do it", and "undo all of that" reverts it. Plus: quotes and dated closes with freshness lines, a trendline from two dates, an indicator-cross alert, a headline conversation, and a screen refined across three turns. The nightly scorecard shows the numbers behind it.

**What could prevent completion in two weeks:**
1. No eval key or Phase A not authorized by day 2 (everything on the critical path waits).
2. The model decision needing a second design round (loop fails B2) — fallback: ship the better model on the current path.
3. F-16 PRs not rebased and reviewed in time — scanning stays off; the demo uses the screener's public fields only.
4. Ownership sign-off for `chartSettingsDescriptors.js` rows and the indicator-alert kind not given — those two items move to the Indicators train.
5. Machine contention (199 worktrees, shared node_modules, two-slot suite lock) — prune to the active set on day 1 and let CI do the heavy runs.
6. Another workstream's RC occupying the gate on RC days — coordinate the two RC windows a day ahead.
