# UCT Agent M1 — release checklist, production acceptance, rollback

**Hard gate:** nothing is pushed until the Indicators team confirms that BOTH `9c6b0eae29`
(formula functions recognised in reopened definitions) and `476420db1e` (a refused open leaves
Chart Settings alone) are merged AND live in production. Their SHAs may change if they land as a
merge or a rebase, so that confirmation is required: a commit appearing on a branch doesn't count.

## A. Release sequence (after the confirmation)

1. `git fetch`; merge the then-current `origin/master` into `feat/uct-agent-m1`, locally only.
2. Before pushing, run on the merged tree:
   - `vitest run src/agent` (M1 28+ cases, routing, discovery, golden, permissions)
   - `vitest run src/components/chart/builder src/components/chart/pane src/pages/charts/widgets/ChartWidget src/components/chart/chartSettingsDescriptors.test.js src/hooks/useUserDefinitions.structuredErrors.test.js`
     - Known red on master, NOT M1: `EvidenceTab.doors` and three `engine/ast` census/measure files (7 tests). Compare the failing set with plain master; only a new failure blocks.
   - `pytest tests/test_uct_agent*.py`
   - `vite build` + `tools/notebook_perf_budgets.py --dist app/dist` (must PASS)
   - local browser runs (scripted model, isolated backend): `fixture_multi.py`, then `agent_m1.py`, `agent_m1b.py`, `agent_batch6.py`, `agent_protected.py`, `agent_integrated.py`
3. Push with the normal guard loop (`push_*.sh`, which **exits if it has to auto-merge**, so a new
   master is re-tested first). No force push, no attestation.
4. Wait for the `master deploy gate` and `promote to production` runs, both green, with
   `notebook bytes` among the checks that ran. Then confirm that Railway `web` SUCCESS is on the
   exact pushed SHA.
5. Unchanged by this release: the Agent stays admin-dark (`uct.feature.agent` + admin role +
   server `require_admin_dark`); `UCT_AGENT_DAILY_CAP` stays 3000; the Create Indicator member
   cohort stays OFF (`rollout_gate` kill switch / no members tagged); no server or config change.

## B. Production acceptance (owner's admin tab, safe fixtures only)

Run on a scratch layout, never Main Trading or Positions. Fingerprint the board
(`charts_workspace_layout` + `charts_active_template`) before and after.

| # | Check | Expect |
|---|---|---|
| 1 | Served bundle | the AgentPanel chunk contains `indicator.openCreate` and "Nothing was created or saved" |
| 2 | Non-admin / no agent flag | no Agent launcher (unchanged gate) |
| 3 | "Can you create a custom indicator?" | partial: opens Create Indicator, never builds or saves |
| 4 | "What indicators are on my chart?" (1 chart) | a table equal to the chart's legend; count excludes Volume ("…(plus the Volume pane)") |
| 5 | Same with 2 charts, none named | "Which indicators?" with one choice per chart; the pick answers from that chart |
| 6 | "Help me build an indicator that highlights candles when the 9 EMA is above the 20 EMA" on a named chart | the studio opens on THAT chart with the text in its box; receipt "…press Send…Nothing was created or saved…" |
| 7 | Repeat while it is open | "…was already open…, so I didn't type over…" |
| 8 | Existing draft (type in the box, close keeping the draft, ask again with a new request) | "your earlier draft is open instead, so your new request was not added" |
| 9 | Flag `uct.feature.createIndicator` off | openCreate absent; a request for it is refused; list still works |
| 10 | Network during 6–9 | zero `/converse`, zero non-GET `/api/user-definitions` |
| 11 | Board fingerprint | identical before and after; Main Trading untouched |
| 12 | Existing Agent | one fast-path chart change + Undo on the scratch layout; one layout list query |

Real-model calls: about 6 turns at most (checks 3, 6–9 and 12).

## C. Rollback

- **Pre-release state:** record the production SHA and Railway `web` deployment id immediately
  before the push. As of this writing that is `523bf837be` (deployment `f06d38a0`, building).
- **Mechanism:** this repo's Railway rollbacks don't hold (the deploy race), and master is shared.
  So rollback is a `git revert -m 1 <M1 merge commit>` on top of the CURRENT master, pushed
  through the same guard and promoted by the gate. Never a reset, a force push, or a redeploy of
  an old image that would drop other teams' commits.
- **Instant mitigation (no deploy):** the Agent is admin-only, so the owner can switch the
  launcher off in their own browser (`localStorage uct.feature.agent = 0`), and
  `uct.feature.createIndicator = 0` removes `indicator.openCreate`.
- **Verify restoration:** the served AgentPanel chunk no longer contains `indicator.openCreate`;
  Railway `web` SUCCESS is on the revert SHA; checks 2, 11 and 12 pass; the board fingerprint is
  unchanged.
