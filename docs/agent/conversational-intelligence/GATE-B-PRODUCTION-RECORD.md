# Gate B — production record (2026-10-13)

| | |
|---|---|
| Released | 2026-10-13, about 16:51 ET (outside the Wednesday 09:00–11:00 ET freeze; `deploy_freeze.py`: NOT FROZEN) |
| Before | master = production = `2d4c93293c` (re-confirmed just before the push) |
| **Production SHA** | **`c84c9ca7c2`** (fast-forward; Gate B only, no Gate C file: diff verified) |
| Pre-push guard | PASS (exit 0): web SUCCESS on `2d4c93293`, settled; 0 web deploys in the last 60 min |
| Master deploy gate | run `38466160096`: success |
| Promote to production | run `38467261771`: success, **`promoted: c84c9ca7c2…`** (not "no") |
| Other push checks | flow-worker deploy coverage, vite build args, notebook budgets/bytes, preference allow-list, term018, wisdom rails: success (the report-only full suite was pending at the time) |

## Railway deployments (all on `c84c9ca7c2`)
| Service | Deployment ID | Status |
|---|---|---|
| web (branch production) | `27341953-7dd8-40b8-b2ea-70110086bb2d` | SUCCESS |
| worker (master) | `0b385fc6-a3e6-4ea0-9655-3919820a1803` | SUCCESS |
| bars-api (master) | `fc11318e-6df0-485a-af64-6720a0de3bbf` | SUCCESS |
| flow-worker (master) | `bd55abab-c646-4757-aad2-562a307b5a31` | **SKIPPED**, as classified: `perplexity_search.py` strand NOT EXERCISED (opt-in keyword), no marker bump |

## Verification
- `GET /api/agent/budget` → **401** without a session, while an unknown `/api/agent/*` path → 200 (page fallback). So the new route is deployed and auth-protected.
- `/api/agent/config` → 401; `/api/health` → 200.
- Web startup logs: clean. Two unrelated third-party `yfinance` "Invalid Crumb" errors.

## Migration
- Four additive SQLite tables in `uct_agent.db` (web volume): `agent_spend`, `agent_requests`, `agent_rate_events`, `agent_inflight`, plus their indexes.
- They are created with `CREATE TABLE IF NOT EXISTS` **on first use** (the first admin model request or rate admission). Concurrent first use is safe (idempotent DDL).
- No existing table is altered. No environment change.
- **Status at release:** pending first use. It is confirmed by the admin smoke step below.
- **Confirmed 2026-10-13 (ET)** by the owner's smoke step: the ledger read back settled rows with tokens, so the tables exist and settle against real usage.

## Paid smoke call (authorised: one Haiku 4.5 call)
- **Not made by me.** There is no Anthropic credential outside production's own variables, and retrieving it would bypass the credential boundary. Cost so far: **$0**.
- **The one controlled call, from the owner's admin session:**
  1. In the Agent panel, send one non-instant request, e.g. "what's driving semis this week?". That is one model call; with research possibly a second model call plus one search; worst case about $0.03, typically about $0.01.
  2. Open `GET /api/agent/budget`. Expect: `cap_usd: 5`; `calls.settled ≥ 1`; tokens > 0; `by_category.turn` > 0; `models: ["claude-haiku-4-5"]`; `site.cap_usd: 15`. That confirms the tables were created (migration) and that reservations settle against real usage.
  3. Free, instant: "show me my strongest stocks". This is the RS Rank production-coverage check for the vocabulary work.

### Result: PASS (owner, admin session, ET day 2026-10-13)
Reported by the owner from the live admin Agent panel and `GET /api/agent/budget`. Not re-read by Claude, which has no production session.

| Check | Expected | Observed | |
|---|---|---|---|
| "what's driving semis this week?" | a model answer | a sourced AI answer | ✅ |
| "show me the strongest stocks" | ranked rows, or a stated refusal | Screener result, sorted by RS Rank (see `VOCABULARY-VERIFICATION.md` Q1) | ✅ |
| `cap_usd` | 5 | 5.00 | ✅ |
| `calls.settled` | ≥ 1 | 3 | ✅ |
| open calls / reserved | — | 0 / $0 (nothing left reserved) | ✅ |
| tokens | > 0 | input 9,630; output 343; cache read 11,608; cache write 11,608 | ✅ |
| settled spend | ≈ $0.01–0.03 | $0.035752 | ✅ (see note) |
| `models` | `["claude-haiku-4-5"]` | `claude-haiku-4-5`, `perplexity` | ✅ by design (see note) |
| `max_calls_per_request` | 2 | 2 | ✅ |
| `site.cap_usd` | 15 | 15.00 (shared spend $11.6336 at read time) | ✅ |
| agent paused | false | false | ✅ |

**Note on `perplexity` and 3 settled rows.** The expectation above was written for an answer without research. A sourced answer takes the research path in `turn.py`: one Haiku call that declares research, one Perplexity query, then a second Haiku call with the results. `budget.py` ledgers the query as `category="research", model="perplexity"` with `counts_as_call=False`. So 3 settled rows = 2 counted model calls (at the ceiling of 2) + 1 research row, which is consistent with the design. The per-request split was not read row by row. The $0.0358 is slightly above the typical estimate because it includes the research row and the second, larger Haiku prompt; it is within the $5 Agent cap.

**Gate B smoke prerequisite for Gate C: satisfied** (2026-10-13).

## Rollback readiness
- Local branch `rollback/agent-gate-b` (C:/w/aconv) at `2a32b9b633`: 13 reverts. Its tree is **identical to `2d4c93293c`** (verified). Not pushed.
- Path: guard → push → master deploy gate → promote; check `promoted`. Railway rollbacks don't hold here.
- The new tables are inert after a revert.

## Baseline test failures (unchanged; all fail identically on pristine master)
- 5 × `test_definition_concierge`
- 1 × `test_notebook_earnings_prep`
- 1 × `test_ai_search_briefings::test_pass_budget_stops_the_sweep_without_stamping`
