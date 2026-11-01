"""MD-1 market-data kinds (owner: agent-md).

Each kind is an adapter over an existing canonical UCT service (see contracts/MD-1-market-data.md §4)
and is added with `registry.register(Kind(...))` inside `register` below. The gateway loads this module
once on first use; nobody edits gateway.py to add a kind.

Sprint 1, PR 1: `quote`, `quotes` (services/massive.py snapshot, read-only — see quotes.py).
"""
from __future__ import annotations

from api.services.uct_agent.marketdata import quotes


def register(registry) -> None:
    from api.services.uct_agent.marketdata.gateway import Kind
    registry.register(Kind(
        name="quote", fn=quotes.read_quote, freshness="live", owner="agent-md", max_symbols=1,
        description="One ticker's latest price from the Massive snapshot. Live in the regular session "
                    f"(stale after {quotes.FRESHNESS_BUDGET_S}s); historical with a note otherwise. "
                    "Params: {symbol}.",
    ))
    registry.register(Kind(
        name="quotes", fn=quotes.read_quotes, freshness="live", owner="agent-md",
        description="Latest prices for up to 50 tickers from one Massive batch snapshot; as_of is the "
                    "oldest quote in the set. Params: {symbols: [...]}.",
    ))
