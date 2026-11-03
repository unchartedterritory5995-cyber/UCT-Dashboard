# RESUME.md — exact state to resume from (written 2026-11-03 ≈07:00Z, owner's usage limit approaching)

**Standing instruction at stop time (owner):** do not merge, deploy, activate features, or change approval boundaries. Everything below is saved to branches; nothing is merged beyond what this file says.

## Production
- master `463a4bcba5` (Wave 1 combined release, PR #718) promoted and live 2026-11-03 04:30:42Z (bundle `index-ePgCEn0Q.js`); later master commits by other sessions (#720, #721, #709 and more; master head at stop ≈ `e6740b5b08`) were promoted on top by their own gates — they contain Wave 1 and touch no Agent file.
- Production flags (read 04:45Z, unchanged since by this program): `UCT_AGENT_STREAM=1`, `UCT_AGENT_DATA=1` with all 11 kinds, `UCT_AGENT_NEWS=1`, `UCT_AGENT_NL1=1`, `UCT_AGENT_SCAN=1`, `AGENT_BREADTH_CURRENT=1`, `UCT_AGENT_DAILY_CAP=3000`; `UCT_AGENT_PLANNER` unset (v2 OFF); `UCT_AGENT_ISOLATED` unset. See FLAGS-INVESTIGATION-2026-11-03.md.
- Phase 1 live test done (LIVE-TESTING-RESULTS-2026-11-03.md): technically deployed, NOT owner-accepted; findings LT-1..LT-12. Disposable layout `W1 Test — 2026-11-03` still exists (owner may delete after Phase 2); owner's UCT Default restored.
- Spend: production Agent ledger ≈ $0.64 for the Phase 1 run (41 model calls). No eval key exists; no paid evaluation has ever run; $0 of the $21 eval budget used.

## Branches and worktrees (all pushed unless marked)
| Branch | Worktree | Base | Purpose | State at stop |
|---|---|---|---|---|
| `agent/int` | C:/w/w1-int | master `e6740b5b08` + program docs | Wave 1 integration / Wave 1.1 RC target | synced with master (10b79c28e6 merge); docs through `06ba3eefcf`+; **no Wave 1.1 code merged** |
| `agent/w11/args` | C:/w/w11-a | agent/int | Wave 1.1 repair-a: LT-3 args tolerance, LT-1 empty-board add, LT-9 rename, LT-10 nonsense | see "Builder reports" below |
| `agent/w11/routing-f16` | C:/w/w11-b | agent/int | Wave 1.1 repair-b: LT-4 routing + no false claims, LT-8/LT-11 hidden phrases + alternative, LT-12 next report | see below |
| `agent/int-w2` | C:/w/w2-int | master `e6740b5b08` | Wave 2 integration (NOT deployed) | no merges yet |
| `agent/w2/intelligence` | C:/w/w2-a | agent/int-w2 | Builder A: multi-turn, v2 eval readiness, args normalizer corpus | see below |
| `agent/w2/market` | C:/w/w2-b | agent/int-w2 | Builder B: research kind/capability, historical analysis, describeSetup | see below |
| `agent/w2/webops` | C:/w/w2-c | agent/int-w2 | Builder C: AgentProvider + page hosts, guide on pages, cross-page workflows | see below |
| `agent/int-w3` | — | agent/int-w2 | Wave 3 integration (NOT deployed) | no merges yet |
| `agent/w3/coach` | C:/w/w3-a | agent/int-w3 | Wave 3 coach: concepts KB + coach.explain, guard suite, consent-gated trade review, coaching workflow, COACH-1 contract | see below |
| `docs/agent-acceleration-audit-2026-11-02` | C:/w/aaudit | master | the audit (Deliverables 1–9, appendices A–H), draft PR #702 | docs only |
| `ci/agent-shard-benchmark` | — | agent/int | shard benchmark trigger branch | measured; keep |
Worktrees share `app/node_modules` by junction to `C:/w/txlinks/app/node_modules` (lockfile identical to master at stop). Python venv: `C:/Users/blake/projects/UCT-Dashboard/.venv`.

## Builder reports at stop
_(filled from each builder's wrap-up message)_
### repair-a — agent/w11/args @ 74a9b21cf4 — DRAFT PR #725 (base agent/int)
- R-01 DONE (args tolerance: per-capability argAliases/coerce/defaults/shape; turn.normalize_args on compact/strict/v2 paths; registry normalizeArgs; catalog prints SHAPE lines; bgMode row made ELIGIBLE so "turn the gradient off" is a 0-call fast path; chart.replay exit words; screener refinement sort shapes; widget.addCharts shapes), R-02 DONE (empty-board add → one new chart, fast path), R-03 DONE (protected rename refused by name, 0 calls; nonsense → deterministic clarify with 5 choices; 5xx keeps FAILED).
- Tests: FULL Agent pytest 2222 passed (125 new, incl. tests/test_uct_agent_args_live_shapes.py); targeted vitest 354 passed (new agentW11RepairA.test.jsx); FULL vitest src/agent NOT CONFIRMED (was running at wrap-up).
- Outside the expected set: app/src/components/chart/chartSettingsDescriptors.js (one bgMode ELIGIBLE row), docs/agent/CAPABILITY-CONTRACT.md.
- Resume: `cd C:/w/w11-a/app && python ../tools/agent_suite_lock.py run --who repair-a -- npx vitest run src/agent/`; fix failures; independent review; then `gh pr ready 725`. Live-model shapes were reconstructed from schemas (no production logs) — the live rerun after deploy is the real check.


## Open PRs at stop
- #702 docs audit (draft, master) — leave.
- #723 (peer session, docs only): Brain Pack → Agent integration proposal; owner decisions D1–D6 pending.
- Wave 1.1 / Wave 2 / Wave 3 draft PRs: listed in the builder reports.

## Running / unfinished tests at stop
- Each builder's full Agent suite run through `tools/agent_suite_lock.py` may have been cut short by the wrap-up; the PR bodies say which suites completed. CI (`agent ci`) runs on every pushed `agent/**` branch; check `gh run list --workflow "agent ci" --branch <branch>` for the head's result before trusting local claims.

## Next steps to resume (in order)
1. `git fetch origin`; read BOARD.md (states) and this file; check `gh pr list --state open --base agent/int`, `--base agent/int-w2`, `--base agent/int-w3`.
2. Wave 1.1: for #(repair-a) and #(repair-b): run the independent review (diff only, security checklist as in QA-W1-COMBINED.md), fix findings, get agent-ci green on the heads, merge into `agent/int` in order a → b, re-sync master, run the combined suites, fill RELEASE-W11-CHECKLIST.md, then open the RC PR to master — **merge/deploy only with the owner's explicit GO** (the conditional overnight authorization lapsed when the owner asked for no merges).
3. After a Wave 1.1 deploy: rerun the failed live scenarios (LIVE-TESTING.md block list; the turn log's X rows) on the disposable layout; record in a new LIVE-TESTING-RESULTS-<date>.md; read `charts_active_template` (read-only) for R-07.
4. Phase 2 owner acceptance session (OWNER-ACCEPTANCE.md, 38 prompts) — the owner tests personally.
5. Wave 2: review + merge each builder PR into `agent/int-w2` on green CI; score the 10 acceptance examples in PROGRAM.md end to end; reconcile W2-A3 (general args normalizer) with repair-a's targeted tolerance when `agent/int` and `agent/int-w2` are reconciled (sync `agent/int-w2` from master after Wave 1.1 ships).
6. Wave 3: review + merge coach PRs into `agent/int-w3`; W3-5/W3-6 unblock only after W2-B2/B3 are merged and reviewed; sync `agent/int-w3` from `agent/int-w2`.
7. Owner decisions outstanding: eval key + Console workspace limit + cap file (for any paid eval); `UCT_AGENT_NL1=1` in production (confirm or unset); `UCT_AGENT_DAILY_CAP=3000` (lower before member rollout); #723 D1–D6; Wave 2/3 deploy approvals (none given).
