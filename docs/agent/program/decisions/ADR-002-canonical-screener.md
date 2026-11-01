# ADR-002 — Agent scans use only the canonical screener

- **Status:** accepted 2026-11-01 as a draft. agent-sc finalizes the inventory section in Sprint 1.
- **Decider:** agent-lead.

## Context

UCT has two screener paths:
- **canonical:** `api/services/screener/query.py`, behind `/api/screener/scan`, `/count`, `/fields` and `/saved-screens`, with coverage receipts;
- **legacy:** `/api/screener` and `/api/candidates` (`engine.get_screener` / `get_candidates`, uct-intelligence wire data). The voice tool `get_scanner_candidates` still reads the legacy path.

## Decision

Agent discovery and scanning (SC-1) use only the canonical screener service. The legacy endpoints are never called by Agent code. No new scan engine is built.

## Inventory (agent-sc, Sprint 1)

- *To complete:* every remaining caller of the legacy paths, with a migration note for their owners.
- Voice/Compass and AI Search are not changed by this program in Sprint 1.
