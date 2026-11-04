# ADR-001 — One market-data gateway (MD-1) for the Agent

- **Status:** accepted 2026-11-01 (owner approved the program).
- **Decider:** agent-lead.

## Context

UCT already reads market data in three separate stacks:
- **UCT Agent:** client capabilities calling REST routes directly.
- **Voice/Compass:** `voice_tools.py`, about 170 tools.
- **AI Search:** a read-only subset of the voice tools.

The program adds three workstreams that all need market data: Market Data, Research and Scanner. If each invented its own access, that would make a fourth, fifth and sixth path.

There are known traps:
- Calling `/api/live-prices` fires price alerts on a cache miss.
- Reading `flow_router` in-process on `web` can come back empty, because `flow.db` lives on flow-worker.
- A second Massive WebSocket knocks out web's live feed.

## Decision

Every Agent market-data read goes through one gateway, `api/services/uct_agent/marketdata/gateway.py`, behind one envelope (MD-1).
- Each kind is an adapter over the canonical UCT service.
- The envelope always carries the source, the data's own `as_of`, and a freshness class.
- Budgets count both logical reads and provider requests.
- It's dark behind `UCT_AGENT_DATA` and admin-only.

## Consequences

- Research and Scanner consume one interface, plus QA's fixtures, in parallel.
- **The envelope is designed for reuse beyond the Agent,** but Voice/Compass and AI Search are not migrated in Sprint 1. Their behaviour is preserved. Migrating them is a later, owner-approved decision.
- The existing client capabilities (`stock.js`, `news.js`) that fetch directly move onto the gateway in Sprint 2.
