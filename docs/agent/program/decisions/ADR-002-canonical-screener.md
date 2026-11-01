# ADR-002 — Agent scans use only the canonical screener

- **Status:** accepted 2026-11-01. The inventory was completed by agent-sc in Sprint 1 PR 4, measured on `agent/int` c3a090e26f.
- **Decider:** agent-lead.

## Context

UCT has two screener paths:
- **canonical:** `api/services/screener/query.py`, behind `/api/screener/scan`, `/count`, `/fields` and `/saved-screens`, with coverage receipts;
- **legacy:** `/api/screener` and `/api/candidates` (`engine.get_screener` / `get_candidates`, uct-intelligence wire data).

## Decision

1. Agent discovery and scanning (SC-1) use only the canonical screener service. The legacy endpoints are never called by Agent code. No new scan engine is built.
2. **Indicator conditions:** Sprint 1 refuses the screener's `scan` key (a definition-results join by bare `def_hash`) and never approximates it (`scan/spec.py` `INDICATOR_KEYS`, railed). Once IC-1 (Indicators-owned, `docs/indicators/IC-1-INDICATOR-CONDITIONS.md`) is approved and scheduled, SC-1 v1.2 adds one kind that delegates exactly as IC-1 specifies: `result_identity` keys, not-run = unavailable, periodic freshness. That will be ADR-004.
3. **Standing rule:** `/api/screener/compile` (`nl_compile.compile_english`) is a paid model path with its own daily cap. The Agent does not use it without the owner's approval. The Agent's planner writes criteria text, and the screener's deterministic grammar parses it (SC-1 §2b).

## Inventory of legacy callers

**Method:** a repo-wide search for `get_candidates`, `get_screener`, `get_scanner_candidates`, and the literal routes `/api/candidates` and bare `/api/screener` (excluding `/api/screener/*`). Each hit was read at its line.

**Agent: zero callers.**
- `api/services/uct_agent/**`, `app/src/agent/**` and `api/routers/uct_agent*.py` contain no legacy call; the only matches are docstrings saying "never".
- Railed by `tests/test_uct_agent_scan_screen.py::test_the_adapters_never_touch_the_legacy_screener_or_alerts`.

**Frontend:** no page fetches either legacy route (`Screener.jsx:70-75`, railed at `Screener.scanmount.test.jsx:490`).

**Remaining server callers.** None of these are changed by this program in Sprint 1; each migration belongs to its owner.

| Caller | Owner | Migration note |
|---|---|---|
| `api/routers/screener.py:76`, `:84` (the routes themselves) | Screener | Keep them until every caller has moved. They're in `docs/api/member-api-whitelist.json` (`:559`, `:4111`), so partner tooling may call them; retiring a route is a separate decision. |
| `voice_market_tools.py:160` `get_scanner_candidates` (also `voice_tool_impls.py:1523/:3552`, `voice_agents.py:120,303,488`, `compass_eval/checks.py:243`) | Voice/Compass | Could read SC-1 `screen.run` or `query.run_scan` with a starter spec. |
| `ai_search_agent.py:44,253` (tool), `ai_search.py:1282,1676` (`_ctx_candidates`) | AI Search | Same migration. Its eval (`ai_search_eval/runner.py:84`, `golden_set_search.json`) names the tool, so a migration keeps the tool name or updates the golden set. |
| `catalyst/sources.py:556` (`scanner_setup` signal) | Catalysts | Migrating changes catalyst scores, so it needs a scoring comparison. |
| `dashboard_signposts.py:214` (candidate count) | Dashboard | Could use `query.preview_count`. Low risk. |
| `journal_two/entry_context.py:468`, `SRC_UCT_SCANS` at `:179` | Journal 2.0 | The source string is persisted in entry-context records and fixtures, so old records must stay readable. It's a J2 contract change. |
| `screener/analyst_pass.py:577` | Screener (inside its own package) | — |
| `scatter.py:500` | Scatter | — |
| `voice_proactive_service.py:341` | Voice/Compass | — |
| `wisdom/capture/families/candidates.py:24` | Wisdom | It captures the legacy envelope as a record (`capture-v1.md:37`), so migrating is a methodology decision. |

**Named but not called:** `auth_surface_check.py:166`, `rate_limit_policy.py:212,249`, `tests/api/test_misc_endpoints.py:37-55`, `tools/notebook_contract_fixtures.py:1142`.
