# UCT Agent program — code ownership

**Owner:** agent-lead. Changes to this file go through agent-lead.

**Rule:** a session writes **only** the paths it owns.

- **Changing someone else's path:** message that owner, copy agent-lead, and let the owner make the change.
- **Lead-owned hot spots:** the default owner for everything in the Agent's paths is agent-lead. That covers `useAgent.js`, `turn.py`, the golden manifest, `builtins.js`, `routing.js` and the others. Specialists *request* changes there.
- **Paths outside the Agent program** are EXTERNAL. Product services stay read-only for Agent sessions: wrap them, never fork them. Any edit there needs agent-lead approval, and often the product owner's too.

Checked by `tools/agent_ownership_check.py` (run `--as <you>` before every PR) and by
`tests/test_uct_agent_program_ownership.py`.

## External owners (unchanged by this program)

| Area | Owner | The Agent uses |
|---|---|---|
| Indicator calculation, chart builder, chart engine (`app/src/components/chart/**`) | Indicators | `agentMutations` / `agentSeams` interfaces only. #516 stays on hold. |
| Charts workspace (`app/src/pages/charts/**`) | Charts | `host.js` adapters (agent-lead) |
| Breadth data (`api/services/market_intel/**`, `breadth_current.py`, the V2 runner) | Market Intelligence | `breadth_current` reads; the runner is the only producer |
| UCT News (`api/services/trade_exchange_news/**`) | News | read APIs |
| Options flow (`flow-worker`, `flow.db`, `api/flow_*`) | Flow | the flow proxy only. Never restart or deploy flow-worker. |
| Screener engine (`api/services/screener/**`) | Screener | `query.py` / `coverage_receipt.py` via SC-1 |
| Voice/Compass (`voice_tools.py` …), AI Search (`ai_search_agent.py`) | their owners | untouched in Sprint 1 |

## Table

Last match wins, and `**` crosses directories.

```ownership
# ── Agent program scope: default owner ──
app/src/agent/**                                   agent-lead
api/services/uct_agent/**                          agent-lead
api/routers/uct_agent*.py                          agent-lead
tests/test_uct_agent*.py                           agent-lead
docs/agent/program/**                              agent-lead
tools/agent_*                                      agent-lead

# ── A · Market Intelligence & Data (contract MD-1) ──
api/services/uct_agent/marketdata/**                     agent-md
app/src/agent/marketdata/**                              agent-md
app/src/agent/capabilities/marketData*.js          agent-md
app/src/agent/agentData*.test.*                    agent-md
tests/test_uct_agent_data*.py                      agent-md
docs/agent/program/contracts/MD-1-*.md             agent-md
docs/agent/program/status/agent-md.md              agent-md
# the gateway framework and the envelope ARE the contract: agent-lead keeps them stable for every consumer
api/services/uct_agent/marketdata/gateway.py             agent-lead
api/services/uct_agent/marketdata/envelope.py            agent-lead
api/services/uct_agent/marketdata/__init__.py            agent-lead

# ── C · Opportunity Discovery & Scanning (contract SC-1) ──
api/services/uct_agent/scan/**                     agent-sc
app/src/agent/capabilities/screener.js             agent-sc
app/src/agent/capabilities/savedScreens.js         agent-sc
app/src/agent/capabilities/scan*.js                agent-sc
app/src/agent/agentScan*.test.*                    agent-sc
tests/test_uct_agent_scan*.py                      agent-sc
docs/agent/program/contracts/SC-1-*.md             agent-sc
docs/agent/program/contracts/SC-2-*.md             agent-sc
docs/agent/program/status/agent-sc.md              agent-sc

# ── QA & integration ──
tests/test_uct_agent_qa_*.py                       agent-qa
app/src/agent/qa/**                                agent-qa
app/src/agent/__fixtures__/program/**              agent-qa
docs/agent/program/status/agent-qa.md              agent-qa

# ── B · Trading Research & Reasoning (Sprint 2; contract RS-1) ──
api/services/uct_agent/research/**                 agent-rs
app/src/agent/capabilities/research*.js            agent-rs
tests/test_uct_agent_research*.py                  agent-rs
docs/agent/program/contracts/RS-1-*.md             agent-rs
docs/agent/program/status/agent-rs.md              agent-rs
```
