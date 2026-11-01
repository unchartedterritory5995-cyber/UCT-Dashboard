# UCT Agent — parallel development program

**Approved by the owner 2026-11-01.** The first wave is four sessions:

| Session | Role | Worktree | Branch prefix |
|---|---|---|---|
| `agent-lead` | Lead / integration architect / release owner | `C:\UCT\agent-lead` | `agent/lead/*` |
| `agent-md` | A: Market Intelligence & Data (MD-1) | `C:\UCT\agent-md` | `agent/md/*` |
| `agent-sc` | C: Opportunity Discovery & Scanning (SC-1) | `C:\UCT\agent-sc` | `agent/sc/*` |
| `agent-qa` | Independent QA & integration | `C:\UCT\agent-qa` | `agent/qa/*` |

`agent-rs` (B: Trading Research & Reasoning, RS-1) joins in Sprint 2, once MD-1 is integrated. D, E, F and G come in later waves.

## Standing rules (all sessions)

**Access and permissions**
- The Agent stays **admin-only** and **NL-1 stays off**.
- New behaviour ships dark behind a server flag that defaults off (`UCT_AGENT_DATA`, `UCT_AGENT_SCAN`, …) and the existing `require_admin_dark` routes.
- Keep canonical action APIs, approvals, receipts, Undo, permissions and every existing limit.

**Data and pipelines**
- **Wrap, don't fork.** No new market-data pipeline, scanner engine, indicator engine, alert evaluator, upstream connection, Massive WebSocket, scheduler job or database.
- Indicators owns indicator calculation and the chart builder. #516 stays on hold.
- Flow data only through the flow proxy. **Never restart or deploy flow-worker.**
- **Data honesty:** source, `as_of` (the data's own time) and a freshness class on every value (MD-1 §3).

**Cost**
- No paid model calls in tests; use the scripted model and `panelHarness`.
- Paid evaluation runs only with the owner's explicit authorization.
- The $5/day Agent and $15 shared AI budgets are unchanged.

**Releases**
- Only `agent-lead` merges to master and promotes, one controlled merge at a time repo-wide, and only with the owner's authorization for that release.
- No weakened CI, branch protections or deployment checks. No force-push or history rewrites.

**The machine**
- Never run `npm ci` or `npm install`: `app/node_modules` is a shared link.
- Run full suites through the suite lock.
- Never run gate shards in parallel.
- Don't touch worktrees you didn't create.

## How work flows (continuous integration)

1. **Branch.** A specialist branches from `origin/agent/int` (`agent/<ws>/<topic>`) and keeps PRs **small and independent**: one kind-group or one feature.
2. **Check ownership:** `python tools/agent_ownership_check.py --as <you>` (against `origin/agent/int`). Fix any FOREIGN or EXTERNAL file, or ask its owner.
3. **Test, holding a suite slot:**
   ```
   python tools/agent_suite_lock.py run --who <you> -- C:\UCT\agent\.venv\Scripts\python.exe -m pytest -q tests/test_uct_agent*.py
   python tools/agent_suite_lock.py run --who <you> -- npx vitest run src/agent src/components/chart/builder/agentMutations   (from app\)
   ```
   - Name server tests `tests/test_uct_agent_*.py` (data: `test_uct_agent_data*.py`, scan: `test_uct_agent_scan*.py`, QA: `test_uct_agent_qa_*.py`) so the master deploy gate runs them too. Client tests live under `app/src/agent/`, which the gate's vitest run covers.
   - Run `UPDATE_AGENT_GOLDEN=1 npx vitest run src/agent/agentContracts.test.js` only when your change registers a capability, and say so in the PR.
   - agent-lead regenerates the golden manifest on `agent/int` after merges. **Never hand-merge a golden conflict.**
4. **Open a PR into `agent/int`** (never master). The description lists:
   - the contract version(s) it implements;
   - the tests you ran, with counts;
   - the ownership check output;
   - the flags involved.
5. **Notify** agent-lead and agent-qa with one message: "PR #N ready: <one line>".
6. **Integrate promptly.** agent-lead reviews and merges compatible PRs into `agent/int` the same working session where possible, and re-runs the Agent suites on `agent/int` after each merge. PR checks run on PRs into `agent/int`, but the Agent pytest/vitest suites only run in the master deploy gate, so these local runs are the integration gate.
7. **QA** runs the conformance, cost and integration suites on `agent/int` and records the verdict in `status/agent-qa.md`.
8. **Release.** An `agent/int` → master release PR happens only when the owner authorizes it. agent-lead runs the usual sync checks (production equals master, nothing in flight), coordinates with the other active release sessions, then merges, promotes and verifies live. Flags stay off in production until the owner turns each one on.

## Communication

**Messages** (cross-session SendMessage, between the session names above) are notices: "PR ready", "blocked on X", "contract change request", "handoff". They are never the record.

**The record is the files in this directory, on `agent/int`:**
- `OWNERSHIP.md`: who owns which path.
- `contracts/`: MD-1, SC-1 (RS-1 in Sprint 2). Versioned.
- `decisions/`: ADRs.
- `status/<session>.md`: each session edits **only its own** status file (in flight, blockers, handoffs, ready for integration). Update it in every PR.
- `INTEGRATION.md`: what "ready to integrate" and "ready to release" mean.

**Blockers:** write one line in your status file, send one message to the blocking owner, and copy agent-lead. If it isn't resolved within one working session, agent-lead decides.

**Contract changes:** follow MD-1 §8. Consumers code against the contract and QA's fixtures, never against an unmerged producer branch.
