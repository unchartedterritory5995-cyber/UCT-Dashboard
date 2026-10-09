# UCT Agent M2 — release checklist, production acceptance, rollback

**Status:** implemented and accepted LOCALLY on `feat/uct-agent-m2`. Not pushed. A separate production
release approval is required.

## Prerequisites (all must hold before any push)
1. Indicators' M2 interface is live: `81d9347405` is in production (`48f478160a`, Railway
   `a18ef16f-b62d-42e4-b620-1cd2a0095598`) — verified 2026-10-09 by git ancestry + Railway.
2. Both teams have accepted §14–§15 (Indicators confirmed; the Agent review is in §14.9–14.10).
3. The production acceptance workspace (§14.8) is established and VERIFIED (section B) before any
   mutation; Indicators runs nothing until it is reported verified.
4. The branch has merged the then-current master and passed the full suite (A).
5. The owner explicitly authorizes the release.

## A. Release sequence
1. Merge `origin/master` into `feat/uct-agent-m2`, locally only.
2. Run on the merged tree:
   - `vitest run src/agent src/components/chart/builder src/components/chart/pane src/pages/charts/widgets/ChartWidget src/components/chart/engine/__tests__/controlDoorCensus.test.js`
   - `pytest tests/test_uct_agent*.py`
   - `vite build` + `tools/notebook_perf_budgets.py --dist app/dist`
   - browser runs (scripted model, isolated local backend): `fixture_multi.py`, then `agent_m2.py`,
     `agent_m1.py`, `agent_m1b.py`, `agent_batch6.py`, `agent_protected.py`, `agent_integrated.py`
3. Guarded push (`push_*.sh`, which exits on auto-merge for a re-test). No force push, no
   attestation.
4. Wait for the deploy gate and promotion to go green, then confirm Railway `web` SUCCESS on the
   exact SHA.
5. Unchanged by this release: the Agent stays admin-dark, the daily cap stays 3000, the Create
   Indicator cohort stays OFF, and no server or config changes are made.

## B. Production acceptance workspace (§14.8) — establish and VERIFY before any mutation
- **Layout:** a NEW admin-owned layout named `Agent Indicators Acceptance`, created empty
  (`layout.create`), holding ONE chart on a test symbol, opened only for the test.
- **Verify before mutating:**
  - `charts_active_template.name === 'Agent Indicators Acceptance'`;
  - its id differs from Main Trading's and Positions';
  - the Main Trading fingerprint is recorded (sha256 of its stored doc);
  - the workspace fingerprint (`charts_workspace_layout` + active template) is recorded;
  - a 2-minute observation window with zero writes.
- Every scripted step targets that workspace's chart ref only.
- **After:** the workspace's effective indicators equal its start state. The only accepted byte
  difference is `{instanceId, deleted:true}` markers from `removeInstance` (Indicators' writer,
  §14.5). The Main Trading fingerprint must be unchanged.

## C. Production acceptance scenarios (admin tab, the workspace above only)
| # | Step | Expect |
|---|---|---|
| 1 | Served bundle | the Agent chunk contains `indicator.remove` and "with its original identity" |
| 2 | "Add RSI to my chart." | `indicator.add` → "Added … (saved)." → the legend shows RSI |
| 3 | Undo | "Removed the … I added (saved)." |
| 4 | "Hide RSI." / "Show RSI." | "Hid … (saved)." / "Showed … (saved)." |
| 5 | "Remove the RSI." | a PROPOSAL "Remove … — nothing else reads it" → Apply → "(saved)" |
| 6 | "Undo that indicator removal." | "Restored … with its original identity (saved)." and the same instanceId |
| 7 | Volume Profile | refused: "…added from Chart Settings." |
| 8 | Reload after a confirmed add | still saved; no Undo offered after the reload |
| 9 | Network during 2–8 | zero `/converse`, zero non-GET `/api/user-definitions` |
| 10 | Fingerprints | Main Trading unchanged; workspace per B |

## D. Rollback
- **Pre-release point:** record the production SHA and Railway deployment id immediately before
  the push.
- **Mechanism:** `git revert -m 1 <M2 merge>` on top of CURRENT master, pushed through the same guard
  and gates. Never reset, force-push or redeploy an old image (master is shared).
- **Instant mitigation (no deploy):**
  - the Agent is admin-dark (`uct.feature.agent = 0` in the owner's browser);
  - the M2 actions are offered only where `canManageIndicators()` is true;
  - nothing in M2 is enabled for members.
- **Verify:** the served Agent chunk no longer contains `indicator.remove`; Railway SUCCESS on the
  revert SHA; M1 checks still pass.
